import fs from 'node:fs';
import path from 'node:path';

export interface AutonomyClosureNotificationSnapshot {
  status: string;
  score: number;
  blockingStages: string[];
  warningStages: string[];
  recommendedTask: {
    title: string;
    acceptanceCriteria?: string;
  } | null;
  stages: Array<{
    stage: string;
    status: string;
    summary: string;
    evidence?: string[];
  }>;
}

export function autonomyClosureSignature(snapshot: AutonomyClosureNotificationSnapshot): string {
  return JSON.stringify({
    status: snapshot.status,
    blockingStages: snapshot.blockingStages,
    recommendedTask: snapshot.recommendedTask?.title ?? null,
  });
}

export function shouldNotifyAutonomyClosureBlock(
  snapshot: AutonomyClosureNotificationSnapshot,
  previousSignature: string | null,
): boolean {
  if (snapshot.blockingStages.length === 0) return false;
  return autonomyClosureSignature(snapshot) !== previousSignature;
}

export function shouldNotifyAutonomyClosureResolved(
  snapshot: AutonomyClosureNotificationSnapshot,
  previousSignature: string | null,
): boolean {
  if (snapshot.blockingStages.length > 0) return false;
  if (!previousSignature) return false;
  return previousSignature !== autonomyClosureSignature(snapshot);
}

export function buildAutonomyClosureResolvedMessage(snapshot: AutonomyClosureNotificationSnapshot): string {
  return [
    `✅ Autonomy closure healthy (score ${snapshot.score})`,
    snapshot.warningStages.length > 0 ? `warnings: ${snapshot.warningStages.join(', ')}` : 'warnings: none',
    snapshot.recommendedTask ? `next: ${snapshot.recommendedTask.title}` : 'next: none',
  ].join('\n');
}

export function buildAutonomyClosureBlockMessage(snapshot: AutonomyClosureNotificationSnapshot): string {
  const blocking = snapshot.blockingStages.join(', ') || 'none';
  const warnings = snapshot.warningStages.length > 0 ? snapshot.warningStages.join(', ') : 'none';
  const evidence = snapshot.blockingStages
    .map(stageName => snapshot.stages.find(stage => stage.stage === stageName))
    .filter(Boolean)
    .map(stage => `- ${stage!.stage}: ${stage!.summary}${stage!.evidence?.[0] ? ` — ${stage!.evidence[0]}` : ''}`);
  return [
    `⚠️ Autonomy closure blocked (score ${snapshot.score})`,
    `blocking: ${blocking}`,
    `warnings: ${warnings}`,
    snapshot.recommendedTask ? `next: ${snapshot.recommendedTask.title}` : null,
    ...evidence,
  ].filter(Boolean).join('\n');
}

export function readAutonomyClosureNotificationSignature(stateDir: string): string | null {
  const filePath = notificationStatePath(stateDir);
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { signature?: string };
    return typeof parsed.signature === 'string' ? parsed.signature : null;
  } catch {
    return null;
  }
}

export function writeAutonomyClosureNotificationSignature(stateDir: string, signature: string): void {
  const filePath = notificationStatePath(stateDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ signature, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
}

function notificationStatePath(stateDir: string): string {
  return path.join(stateDir, 'autonomy-closure-notifier.json');
}
