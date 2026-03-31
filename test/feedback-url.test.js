import { describe, it, expect } from 'vitest';

// Extracted from renderer.js feedback URL generation
function buildFeedbackUrl(type, version) {
  const repoBase = 'https://github.com/itsela-ms/DeepSky/issues/new';
  if (type === 'bug') {
    const title = encodeURIComponent('[Bug] ');
    const body = encodeURIComponent(
      `**DeepSky Version:** v${version}\n\n` +
      `**Describe the bug:**\n<!-- A clear description of what the bug is. -->\n\n` +
      `**Steps to reproduce:**\n1. \n2. \n3. \n\n` +
      `**Expected behavior:**\n\n` +
      `**Actual behavior:**\n`
    );
    return `${repoBase}?labels=bug&title=${title}&body=${body}`;
  } else {
    const title = encodeURIComponent('[Feature] ');
    const body = encodeURIComponent(
      `**DeepSky Version:** v${version}\n\n` +
      `**Feature Request:**\n<!-- A clear description of the feature you'd like. -->\n\n` +
      `**Problem it solves:**\n\n` +
      `**Proposed solution:**\n`
    );
    return `${repoBase}?labels=enhancement&title=${title}&body=${body}`;
  }
}

const REPO_BASE = 'https://github.com/itsela-ms/DeepSky/issues/new';

describe('buildFeedbackUrl', () => {
  describe('bug reports', () => {
    it('contains labels=bug', () => {
      const url = buildFeedbackUrl('bug', '1.0.0');
      expect(url).toContain('labels=bug');
    });

    it('contains the version', () => {
      const url = buildFeedbackUrl('bug', '0.8.5');
      expect(url).toContain(encodeURIComponent('v0.8.5'));
    });

    it('contains Steps to reproduce template', () => {
      const url = buildFeedbackUrl('bug', '1.0.0');
      expect(url).toContain(encodeURIComponent('**Steps to reproduce:**'));
    });

    it('starts with the correct repo base', () => {
      const url = buildFeedbackUrl('bug', '1.0.0');
      expect(url.startsWith(REPO_BASE)).toBe(true);
    });
  });

  describe('feature requests', () => {
    it('contains labels=enhancement', () => {
      const url = buildFeedbackUrl('feature', '1.0.0');
      expect(url).toContain('labels=enhancement');
    });

    it('contains the version', () => {
      const url = buildFeedbackUrl('feature', '2.3.1');
      expect(url).toContain(encodeURIComponent('v2.3.1'));
    });

    it('contains Feature Request template', () => {
      const url = buildFeedbackUrl('feature', '1.0.0');
      expect(url).toContain(encodeURIComponent('**Feature Request:**'));
    });

    it('starts with the correct repo base', () => {
      const url = buildFeedbackUrl('feature', '1.0.0');
      expect(url.startsWith(REPO_BASE)).toBe(true);
    });
  });

  describe('URL encoding', () => {
    it('bug URL has no raw spaces', () => {
      const url = buildFeedbackUrl('bug', '1.0.0');
      // Only check the query string portion (after ?)
      const query = url.split('?')[1];
      expect(query).not.toContain(' ');
    });

    it('bug URL has no raw newlines', () => {
      const url = buildFeedbackUrl('bug', '1.0.0');
      expect(url).not.toContain('\n');
    });

    it('feature URL has no raw spaces', () => {
      const url = buildFeedbackUrl('feature', '1.0.0');
      const query = url.split('?')[1];
      expect(query).not.toContain(' ');
    });

    it('feature URL has no raw newlines', () => {
      const url = buildFeedbackUrl('feature', '1.0.0');
      expect(url).not.toContain('\n');
    });
  });
});
