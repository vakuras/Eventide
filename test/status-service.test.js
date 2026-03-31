import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const StatusService = require('../src/status-service');

let tmpDir;
let svc;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'deepsky-status-'));
  svc = new StatusService(tmpDir);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function writePlan(sessionId, content) {
  const sessionDir = path.join(tmpDir, sessionId);
  await fs.promises.mkdir(sessionDir, { recursive: true });
  await fs.promises.writeFile(path.join(sessionDir, 'plan.md'), content, 'utf8');
  return sessionDir;
}

describe('StatusService next step summaries', () => {
  it('keeps concise checkbox steps unchanged', async () => {
    await writePlan('short-steps', [
      '# Test Plan',
      '',
      '## Next Steps',
      '- [ ] Engage source tenant admin',
      '- [ ] Roll traffic to AME',
    ].join('\n'));

    const status = await svc.getSessionStatus('short-steps');
    expect(status.nextSteps.map(step => step.text)).toEqual([
      'Engage source tenant admin',
      'Roll traffic to AME',
    ]);
  });

  it('summarizes verbose checkbox steps to six words or fewer', async () => {
    await writePlan('verbose-steps', [
      '# Test Plan',
      '',
      '## Next Steps',
      '- [ ] Engage the Source Tenant Admin by posting in the support Teams channel with all app details',
      '- [ ] Download the `AppMigration` PowerShell artifacts from the latest successful pipeline build',
    ].join('\n'));

    const status = await svc.getSessionStatus('verbose-steps');
    expect(status.nextSteps.map(step => step.text)).toEqual([
      'Engage the Source Tenant Admin',
      'Download the AppMigration PowerShell artifacts',
    ]);
    expect(status.nextSteps.every(step => step.text.split(/\s+/).length <= 6)).toBe(true);
  });

  it('summarizes numbered fallback steps to six words or fewer', async () => {
    await writePlan('numbered-steps', [
      '# Test Plan',
      '',
      '## Next Steps',
      '1. **Acquire the AME token and prepare destination migration** - extra details go here',
      '2. **Soft-delete Corp source app after bake** - more details',
    ].join('\n'));

    const status = await svc.getSessionStatus('numbered-steps');
    expect(status.nextSteps.map(step => step.text)).toEqual([
      'Acquire the AME token and prepare',
      'Soft-delete Corp source app after bake',
    ]);
    expect(status.nextSteps.every(step => step.text.split(/\s+/).length <= 6)).toBe(true);
  });

  it('skips empty checkbox items after summarization', async () => {
    await writePlan('empty-steps', [
      '# Test Plan',
      '',
      '## Next Steps',
      '- [ ]    ',
      '- [ ] Roll traffic to AME',
    ].join('\n'));

    const status = await svc.getSessionStatus('empty-steps');
    expect(status.nextSteps).toHaveLength(1);
    expect(status.nextSteps[0]).toMatchObject({
      text: 'Roll traffic to AME',
      current: true,
      done: false,
    });
  });

  it('preserves unicode characters in summarized steps', async () => {
    await writePlan('unicode-steps', [
      '# Test Plan',
      '',
      '## Next Steps',
      '- [ ] Mettre à jour résumé partagé',
      '- [ ] Validate café migration readiness',
    ].join('\n'));

    const status = await svc.getSessionStatus('unicode-steps');
    expect(status.nextSteps.map(step => step.text)).toEqual([
      'Mettre à jour résumé partagé',
      'Validate café migration readiness',
    ]);
  });
});
