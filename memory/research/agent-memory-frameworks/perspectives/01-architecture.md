# Architecture Perspective: Agent Memory Frameworks

## Overview

This perspective analyzes the architectural approaches of modern agent memory frameworks (2024-2026), focusing on storage models, retrieval mechanisms, and system organization patterns.

---

## 1. MemoryOS

**Paper**: Memory OS of AI Agent (EMNLP 2025 Oral)  
**Institution**: BAI-LAB  

### Architecture

**Three-tier hierarchical storage** (inspired by OS memory management):

```
Short-term Memory  →  Mid-term Memory  →  Long-term Personal Memory
   (FIFO)              (Segmented Pages)      (Persistent Store)
```

**Core Modules**:
1. **Memory Storage**: Manages three-tier storage units
2. **Memory Updating**: 
   - Short → Mid: Dialogue-chain-based FIFO
   - Mid → Long: Segmented page organization
3. **Memory Retrieval**: Pluggable retrieval algorithms
4. **Memory Generation**: Integrates with LLM context

**Design Philosophy**: Operating system metaphor - memory as a resource with hierarchical caching and eviction policies.

### Strengths
- Clean separation of concerns (storage/update/retrieval/generation)
- Plug-and-play architecture allows swapping components
- Proven performance (49.11% F1 improvement on LoCoMo)
- Supports multiple LLMs (OpenAI, Deepseek, Qwen)
- Vector DB integration (Chromadb)

### Weaknesses
- Still relies on predetermined update strategies (FIFO, segmentation)
- Hierarchical tiers may lose contextual relationships during consolidation
- No self-organizing capability - update rules are fixed

### Relevance to mini-agent
- **Aligned**: Hierarchical storage mirrors mini-agent's Hot/Warm/Cold memory
- **Divergent**: MemoryOS uses vector DB; mini-agent uses grep (No Embedding principle)
- **Insight**: Segmented page organization for mid→long could inform daily→MEMORY consolidation

---

## 2. A-MEM (Agentic Memory)

**Paper**: A-MEM: Agentic Memory for LLM Agents (NeurIPS 2025)  
**Institution**: AGI Research  

### Architecture

**Zettelkasten-inspired network** - memories as interconnected notes:

```
New Memory → Generate Note (attributes, keywords, tags)
          → Establish Links (based on shared attributes)
          → Evolve Existing Memories (incorporate new experiences)
```

**Core Mechanism**:
- **Note Generation**: Contextual descriptions + structured attributes
- **Dynamic Linking**: Autonomous connection based on semantic similarity
- **Memory Evolution**: Existing memories update with new experiences
- **Higher-order Attributes**: Emergent through ongoing interactions

**Design Philosophy**: Self-organizing knowledge network without fixed structures.

### Strengths
- No predefined schema - adapts to diverse tasks
- Continuous evolution rather than static storage
- Superior performance on long-term conversational tasks (6 foundation models)
- Mirrors human Zettelkasten method (proven knowledge management)

### Weaknesses
- Computational overhead for dynamic linking on every new memory
- Potential for link proliferation (graph becomes unwieldy)
- No explicit consolidation or forgetting mechanism
- Evolution process may drift without guardrails

### Relevance to mini-agent
- **Aligned**: Self-organizing aligns with mini-agent's autonomy principles
- **Divergent**: A-MEM uses graph structure; mini-agent uses flat files
- **Insight**: Dynamic attribute generation could enhance topic memory scoping

---

## 3. Mem0

**Paper**: Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory (arXiv 2504.19413)  
**Institution**: Mem0 AI (YC-backed)  

### Architecture

**Hybrid datastore** (parallel writes to multiple systems):

```
Add Memory → Vector Store (similarity search)
          → Graph Store (relationship tracking)
          → History Log (audit trail)
```

**Five-Pillar Architecture**:
1. **LLM-Powered Fact Extraction**: Conversation → atomic facts
2. **Vector Storage**: Semantic similarity (concepts, not keywords)
3. **Graph Storage**: Explicit relationships (people, companies, problems)
4. **Unified APIs**: Abstract over episodic/semantic/procedural/associative memory types
5. **Lifecycle Management**: Automatic filtering, decay, consolidation

**Design Philosophy**: Production-first - scalability, cost optimization, API simplicity.

### Strengths
- Hybrid approach combines strengths (vector + graph + log)
- Production-ready with cost optimization features
- Unified API abstracts complexity
- Automatic memory bloat prevention
- Complete audit trail via history log

### Weaknesses
- Requires multiple external systems (vector DB, graph DB)
- Complexity in maintaining consistency across stores
- Vendor lock-in to Mem0's infrastructure
- Overhead of parallel writes may impact latency

### Relevance to mini-agent
- **Aligned**: Audit trail (File = Truth, transparency)
- **Divergent**: Requires database infrastructure; violates No Database principle
- **Insight**: Decay mechanisms and automatic filtering could be implemented file-based

---

## 4. TotalRecall AI

**Source**: Website and limited public documentation  
**Type**: Commercial cognitive architecture  

### Architecture

**Multi-layer cognitive system**:

```
Knowledge Graph Layer
         ↕
  Memory Layers
         ↕
Coordinated AI Agents
```

**Core Capabilities**:
- Cross-session knowledge retention
- Multi-agent coordination
- Learning and evolution over time

**Design Philosophy**: Cognitive architecture for multi-agent ecosystems.

### Strengths
- Designed for multi-agent coordination (not just single agent)
- Persistent cross-session learning
- Commercial focus suggests production-readiness

### Weaknesses
- Limited public documentation
- Appears to be closed-source commercial system
- Unclear memory lifecycle and retrieval mechanisms
- Unknown scalability characteristics

### Relevance to mini-agent
- **Aligned**: Cross-session persistence (mini-agent's long-term memory)
- **Divergent**: Multi-agent focus vs. mini-agent's single personal agent
- **Insight**: Limited - insufficient technical details

---

## 5. MemSkill

**Paper**: MemSkill: Learning and Evolving Memory Skills for Self-Evolving Agents (arXiv 2602.02474)  
**Date**: February 2026  

### Architecture

**Skill-based memory operations**:

```
Interaction Traces → Controller (skill selection)
                  → Executor (skill-guided memory creation)
                  → Designer (skill evolution)
```

**Three Components**:
1. **Controller**: Learns to select relevant memory skills
2. **Executor**: LLM-based, produces skill-guided memories
3. **Designer**: Reviews hard cases, refines/proposes new skills

**Design Philosophy**: Memory operations as learnable skills, not fixed procedures.

### Strengths
- Breaks free from static hand-designed operations
- Skills evolve based on actual performance (hard cases)
- Small set of relevant skills (not all skills every time)
- Generalizes across diverse settings (LoCoMo, LongMemEval, HotpotQA, ALFWorld)

### Weaknesses
- Three-component architecture adds complexity
- Designer requires periodic review cycles (latency)
- Skill proliferation risk (how many skills is too many?)
- Learning overhead may not justify gains in simple scenarios

### Relevance to mini-agent
- **Aligned**: Evolving capabilities (mini-agent's autonomous learning)
- **Aligned**: Skill framework mirrors mini-agent's skills/*.md
- **Insight**: Could treat memory operations (REMEMBER, topic scoping) as evolvable skills
- **Challenge**: Designer component requires meta-learning infrastructure

---

## 6. MemGen

**Paper**: MemGen: Weaving Generative Latent Memory for Self-Evolving Agents (arXiv 2509.24704)  
**Date**: October 2025  

### Architecture

**Generative latent memory** (memory as generated tokens):

```
Agent State → Memory Trigger (decide to invoke memory)
           → Memory Weaver (construct latent token sequence)
           → Enrich Reasoning Context
```

**Two Components**:
1. **Memory Trigger**: Monitors reasoning state, decides when to invoke memory
2. **Memory Weaver**: Takes current state as stimulus, generates latent tokens as machine-native memory

**Design Philosophy**: Memory as generated tokens (not retrieved text, not fine-tuned weights).

### Strengths
- Avoids catastrophic forgetting (no weight updates)
- Avoids static retrieval limitations (dynamic generation)
- Emergent memory hierarchy (planning, procedural, working) without supervision
- 38.22% improvement over external memory systems
- Strong cross-domain generalization

### Weaknesses
- Latent memory is not human-readable (violates transparency)
- Memory trigger logic may miss important moments
- Token generation overhead on every invocation
- Unclear how to debug or audit generated memories

### Relevance to mini-agent
- **Aligned**: Self-evolving, autonomous memory creation
- **Divergent**: Latent tokens violate File = Truth and Transparency principles
- **Insight**: Memory trigger concept could inform when to create memory checkpoints

---

## 7. MemRL

**Paper**: MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory (arXiv 2601.03192)  
**Date**: January 2026  

### Architecture

**RL-guided episodic memory retrieval**:

```
Episodic Memory Store
        ↓
Two-Phase Retrieval:
  Phase 1: Semantic Filtering (relevance)
  Phase 2: Q-value Selection (utility)
        ↓
High-utility strategies → Action
```

**Core Innovation**: Q-learning on retrieval policy - learns which memories are useful.

**Design Philosophy**: Episodic memory + reinforcement learning = runtime improvement without weight updates.

### Strengths
- No model fine-tuning required
- Learns from environmental feedback (not just similarity)
- Outperforms RAG on complex benchmarks
- Addresses stability-plasticity dilemma
- Effective in dynamic environments

### Weaknesses
- Requires environment with clear reward signals
- Q-value learning overhead
- May struggle in sparse reward environments
- Two-phase retrieval adds latency

### Relevance to mini-agent
- **Aligned**: Runtime learning without model updates (mini-agent is non-parametric)
- **Aligned**: Episodic memory focus (mini-agent's daily/*.md)
- **Insight**: Could learn which topic memories are most useful for different query types
- **Challenge**: Requires reward signal - unclear in personal agent context

---

## 8. MAGMA

**Paper**: MAGMA: A Multi-Graph based Agentic Memory Architecture for AI Agents (arXiv 2601.03236)  
**Date**: January 2026  

### Architecture

**Multi-graph representation** (orthogonal views):

```
Memory Item → Semantic Graph (similarity)
           → Temporal Graph (time relationships)
           → Causal Graph (cause-effect)
           → Entity Graph (entity relationships)
           → Vector DB (baseline similarity)
```

**Retrieval**: Policy-guided traversal over relational views (query-adaptive).

**Design Philosophy**: Decouple memory representation from retrieval logic via orthogonal graphs.

### Strengths
- Transparent reasoning paths (interpretable traversal)
- Query-adaptive retrieval (not one-size-fits-all)
- 45.5% higher reasoning accuracy
- 95% token reduction
- 40% faster query latency

### Weaknesses
- Requires maintaining 4+ graph structures
- Graph construction overhead on memory insertion
- Complex policy learning for traversal
- May be overkill for simple retrieval tasks

### Relevance to mini-agent
- **Aligned**: Transparency (explicit reasoning paths)
- **Divergent**: Requires graph databases (violates No Database)
- **Insight**: Could implement lightweight temporal/causal linking in markdown (e.g., YAML frontmatter)
- **Insight**: Query-adaptive retrieval could inform smart topic loading

---

## 9. EverMemOS

**Paper**: EverMemOS: A Self-Organizing Memory Operating System for Structured Long-Horizon Reasoning (arXiv 2601.02163)  
**Date**: January 2026  

### Architecture

**Engram-inspired three-phase lifecycle**:

```
Phase 1: Episodic Trace Formation
  Dialogue → MemCells (episodic traces + atomic facts + Foresight)

Phase 2: Semantic Consolidation
  MemCells → MemScenes (thematic clusters + user profiles)

Phase 3: Reconstructive Recollection
  MemScene-guided agentic retrieval → Context composition
```

**Design Philosophy**: Memory as lifecycle (formation → consolidation → recollection), inspired by neuroscience.

### Strengths
- Biologically-inspired (engram theory)
- Consolidation resolves conflicts and evolves user state
- State-of-the-art on memory-augmented reasoning
- Continuous contextual understanding for long-term agents
- Foresight signals enable anticipatory context

### Weaknesses
- Three-phase pipeline adds complexity
- MemCell → MemScene consolidation may lose granularity
- Unclear consolidation frequency (periodic? triggered?)
- Agentic retrieval overhead

### Relevance to mini-agent
- **Aligned**: Lifecycle approach mirrors Hot/Warm/Cold transitions
- **Aligned**: Semantic consolidation similar to daily → MEMORY
- **Insight**: Foresight signals could inform proactive task creation
- **Insight**: MemScene concept similar to mini-agent's topic memory

---

## Architectural Patterns Summary

### Storage Models

| Framework | Model | Persistence |
|-----------|-------|-------------|
| MemoryOS | Hierarchical tiers | Vector DB + disk |
| A-MEM | Dynamic graph | Graph DB |
| Mem0 | Hybrid (vector+graph+log) | Multi-store |
| TotalRecall | Knowledge graph + layers | Unknown |
| MemSkill | Skill-guided records | Implementation-dependent |
| MemGen | Latent tokens | In-memory generation |
| MemRL | Episodic store + Q-values | Vector DB + RL state |
| MAGMA | Multi-graph + vector | 4 graphs + vector DB |
| EverMemOS | MemCells → MemScenes | Structured store |

### Retrieval Strategies

| Framework | Strategy | Adaptation |
|-----------|----------|------------|
| MemoryOS | Pluggable algorithms | Static |
| A-MEM | Link traversal | Dynamic (evolving links) |
| Mem0 | Hybrid (vector+graph) | Static + decay |
| MemSkill | Skill-selected | Learned (controller) |
| MemGen | Generated on-demand | Triggered |
| MemRL | Two-phase (semantic+Q) | RL-optimized |
| MAGMA | Policy-guided graph traversal | Query-adaptive |
| EverMemOS | MemScene-guided agentic | Context-aware |

### Complexity vs. Flexibility

```
High Flexibility, High Complexity: MAGMA, A-MEM, EverMemOS
High Flexibility, Medium Complexity: MemSkill, MemRL, Mem0
Medium Flexibility, Low Complexity: MemoryOS, MemGen
Unknown: TotalRecall
```

---

## Key Architectural Insights for mini-agent

1. **Lifecycle over Static Storage**: EverMemOS and MemoryOS show value in phase-based memory evolution (formation → consolidation → recollection)

2. **Learn What to Remember**: MemSkill and MemRL demonstrate that memory operations themselves can be learned, not hand-coded

3. **Multi-view Representation**: MAGMA's orthogonal graphs (semantic/temporal/causal/entity) could be approximated with structured markdown frontmatter

4. **Trigger-based Invocation**: MemGen's memory trigger concept could optimize when to create checkpoints or consolidate

5. **Self-organization Wins**: A-MEM shows autonomous memory organization outperforms fixed schemas in diverse tasks

6. **Transparency Trade-offs**: MemGen achieves performance but sacrifices auditability; MAGMA maintains interpretability via explicit graph traversal

7. **No Database ≠ No Structure**: Most frameworks use databases, but their organizational principles (hierarchies, links, lifecycles) can be implemented file-based

---

## Next Steps

- **Perspective 2**: Analyze cognitive/workflow aspects (how these systems learn and evolve)
- **Perspective 3**: Industry practices and deployment patterns
- **Synthesis**: Distill actionable patterns for mini-agent evolution
