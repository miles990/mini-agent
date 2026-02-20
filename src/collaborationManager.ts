import { initManusClient, execManus as callManusBrain, disconnectManusClient } from './manusBrain.js';
import { getSystemPrompt } from './dispatcher.js';
import { slog } from './utils.js';
import { getMemory, updateMemory } from './memory.js';
import { callLogic } from './agent.js'; // Assuming callLogic can be imported and used for Claude calls

// Define CollaborationMode enum
export enum CollaborationMode {
  RELAY = 'relay',
  REVIEW = 'review',
  DEBATE = 'debate',
  TOOL_ASSIST = 'tool_assist',
  // Add other modes as needed
}

// Define AgentContext interface (simplified for this example)
interface AgentContext {
  currentContext: string;
  systemPrompt: string;
  loopGeneration: number;
  rebuildContext?: (mode: 'focused' | 'minimal') => Promise<string>;
  cycleMode?: any; // Assuming cycleMode exists in agentContext
}

interface CollaborationState {
  mode: CollaborationMode;
  taskId: string;
  history: { sender: 'claude' | 'manus' | 'user', content: string }[];
  sharedContext: string;
  turn: number; // To limit infinite loops
  maxTurns: number;
  // Add mode-specific state here if necessary
  debateState?: { claudeResponse: string; manusResponse: string; lastSender: 'claude' | 'manus' | null };
}

class CollaborationManager {
  private activeCollaborations: Map<string, CollaborationState> = new Map();
  private MAX_COLLABORATION_TURNS = 5; // Limit turns to prevent infinite loops

  constructor() {
    slog('COLLAB_MGR', 'CollaborationManager initialized.');
  }

  /**
   * Starts a new collaboration session.
   * @param taskId Unique ID for the collaboration session.
   * @param mode The collaboration mode to use.
   * @param initialPrompt The initial prompt from the user.
   * @param agentContext The current context of the mini-agent.
   * @returns The final response from the collaboration.
   */
  async startCollaboration(
    taskId: string,
    mode: CollaborationMode,
    initialPrompt: string,
    agentContext: AgentContext
  ): Promise<string> {
    slog('COLLAB_MGR', `Starting collaboration for task ${taskId} in ${mode} mode.`);

    const initialState: CollaborationState = {
      mode,
      taskId,
      history: [{ sender: 'user', content: initialPrompt }],
      sharedContext: agentContext.currentContext, // Initial shared context
      turn: 0,
      maxTurns: this.MAX_COLLABORATION_TURNS,
    };
    this.activeCollaborations.set(taskId, initialState);

    let currentResponse = initialPrompt;
    let currentSender: 'user' | 'claude' | 'manus' = 'user';

    try {
      while (initialState.turn < initialState.maxTurns) {
        initialState.turn++;
        slog('COLLAB_MGR', `Task ${taskId}, Turn ${initialState.turn}, Mode: ${mode}`);

        let nextAction: { target: 'claude' | 'manus', prompt: string } | null = null;

        switch (mode) {
          case CollaborationMode.RELAY:
            nextAction = await this.relayModeLogic(initialState, currentResponse, currentSender, agentContext);
            break;
          case CollaborationMode.REVIEW:
            nextAction = await this.reviewModeLogic(initialState, currentResponse, currentSender, agentContext);
            break;
          case CollaborationMode.DEBATE:
            nextAction = await this.debateModeLogic(initialState, currentResponse, currentSender, agentContext);
            break;
          case CollaborationMode.TOOL_ASSIST:
            nextAction = await this.toolAssistModeLogic(initialState, currentResponse, currentSender, agentContext);
            break;
          default:
            throw new Error(`Unsupported collaboration mode: ${mode}`);
        }

        if (!nextAction) {
          slog('COLLAB_MGR', `Collaboration for task ${taskId} completed or stalled.`);
          break; // Collaboration completed or no further action needed
        }

        const fullPromptForLLM = `${agentContext.systemPrompt}\n\n${initialState.sharedContext}\n\n---\n\nUser: ${nextAction.prompt}`;

        let llmResult: { response: string, attachments?: string[] };
        if (nextAction.target === 'claude') {
          slog('COLLAB_MGR', `Sending to Claude: ${nextAction.prompt.substring(0, Math.min(nextAction.prompt.length, 100))}...`);
          // Call the actual Claude provider via callLogic
          const claudeCallResult = await callLogic(nextAction.prompt, initialState.sharedContext, 2, { source: 'loop', cycleMode: agentContext.cycleMode });
          llmResult = { response: claudeCallResult.response };
        } else {
          slog('COLLAB_MGR', `Sending to Manus: ${nextAction.prompt.substring(0, Math.min(nextAction.prompt.length, 100))}...`);
          llmResult = await callManusBrain(fullPromptForLLM); // Use actual Manus brain
        }

        currentResponse = llmResult.response;
        currentSender = nextAction.target;
        initialState.history.push({ sender: currentSender, content: currentResponse });
        initialState.sharedContext += `\n\n${currentSender} responded: ${currentResponse}`; // Update shared context
        await updateMemory(agentContext, `Collaboration ${taskId} - ${currentSender} response: ${currentResponse}`);
      }

      if (initialState.turn >= initialState.maxTurns) {
        slog('COLLAB_MGR', `Collaboration for task ${taskId} reached max turns (${initialState.maxTurns}).`);
      }

      // Return the last response as the final result of the collaboration
      return initialState.history[initialState.history.length - 1]?.content || "No response from collaboration.";

    } catch (error) {
      slog('COLLAB_MGR', `Error during collaboration for task ${taskId}: ${error}`);
      throw error;
    } finally {
      this.activeCollaborations.delete(taskId);
      slog('COLLAB_MGR', `Collaboration for task ${taskId} ended.`);
    }
  }

  // --- Collaboration Mode Logics (Simplified for brevity) ---

  private async relayModeLogic(
    state: CollaborationState,
    lastResponse: string,
    lastSender: 'user' | 'claude' | 'manus',
    agentContext: AgentContext
  ): Promise<{ target: 'claude' | 'manus', prompt: string } | null> {
    // Example: User -> Claude -> Manus -> Final
    if (state.turn === 1 && lastSender === 'user') {
      return { target: 'claude', prompt: `Initial task: ${lastResponse}` };
    } else if (state.turn === 2 && lastSender === 'claude') {
      return { target: 'manus', prompt: `Claude's analysis: ${lastResponse}. Please elaborate or perform tool-assisted research.` };
    } else if (state.turn === 3 && lastSender === 'manus') {
      return { target: 'claude', prompt: `Manus's findings: ${lastResponse}. Please summarize and finalize.` };
    }
    return null; // End collaboration
  }

  private async reviewModeLogic(
    state: CollaborationState,
    lastResponse: string,
    lastSender: 'user' | 'claude' | 'manus',
    agentContext: AgentContext
  ): Promise<{ target: 'claude' | 'manus', prompt: string } | null> {
    // Example: Claude drafts, Manus reviews
    if (state.turn === 1 && lastSender === 'user') {
      return { target: 'claude', prompt: `Draft a report on: ${lastResponse}` };
    } else if (state.turn === 2 && lastSender === 'claude') {
      return { target: 'manus', prompt: `Please review this draft from Claude: ${lastResponse}. Provide feedback and suggestions.` };
    } else if (state.turn === 3 && lastSender === 'manus') {
      // Manus has reviewed, now Claude can revise or we can finalize
      return null; // For simplicity, end after one review cycle
    }
    return null;
  }

  private async debateModeLogic(
    state: CollaborationState,
    lastResponse: string,
    lastSender: 'user' | 'claude' | 'manus',
    agentContext: AgentContext
  ): Promise<{ target: 'claude' | 'manus', prompt: string } | null> {
    // Example: Both respond, then critique each other
    if (state.turn === 1 && lastSender === 'user') {
      // Send to both initially (this needs to be handled outside this single-target return)
      // For now, let's alternate for simplicity in this example structure
      return { target: 'claude', prompt: `Debate topic: ${lastResponse}. Provide your initial stance.` };
    } else if (state.turn === 2 && lastSender === 'claude') {
      return { target: 'manus', prompt: `Claude's stance: ${lastResponse}. Provide your counter-argument or alternative.` };
    } else if (state.turn === 3 && lastSender === 'manus') {
      return { target: 'claude', prompt: `Manus's counter: ${lastResponse}. How do you respond?` };
    }
    return null;
  }

  private async toolAssistModeLogic(
    state: CollaborationState,
    lastResponse: string,
    lastSender: 'user' | 'claude' | 'manus',
    agentContext: AgentContext
  ): Promise<{ target: 'claude' | 'manus', prompt: string } | null> {
    // Example: Claude requests a tool, Manus executes
    // This logic would parse `lastResponse` for a `[TOOL_REQUEST]` tag.
    const toolRequestMatch = lastResponse.match(/\[TOOL_REQUEST: (\w+), query=(.*?)\]/);
    if (toolRequestMatch) {
      const toolName = toolRequestMatch[1];
      const query = toolRequestMatch[2];
      slog('COLLAB_MGR', `Tool request detected: ${toolName} with query '${query}'`);
      // Route to Manus for tool execution
      return { target: 'manus', prompt: `Execute tool '${toolName}' with query '${query}' and report results.` };
    } else if (lastSender === 'manus' && state.turn > 1) {
      // Manus has executed a tool, now send results back to Claude for analysis
      return { target: 'claude', prompt: `Tool execution results from Manus: ${lastResponse}. Please analyze and continue the task.` };
    }
    // Initial prompt or no tool request yet, send to Claude first
    if (state.turn === 1 && lastSender === 'user') {
      return { target: 'claude', prompt: `Initial task requiring potential tool use: ${lastResponse}` };
    }
    return null;
  }

  // Helper to build shared context (can be expanded to use memory system)
  private async buildSharedContext(agentContext: AgentContext): Promise<string> {
    // For now, just return the current context. In a real system, this would aggregate
    // relevant information from agentContext.currentContext, history, and memory.
    return agentContext.currentContext;
  }
}

export const collaborationManager = new CollaborationManager();
