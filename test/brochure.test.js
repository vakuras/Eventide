import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Brochure validation tests.
 *
 * Ensures the brochure HTML stays in sync with the current DeepSky version,
 * has correct download links, accurate feature lists, and a mock that
 * reflects the latest UI capabilities.
 */

const PKG_PATH = join(__dirname, '..', 'package.json');
const CHANGELOG_PATH = join(__dirname, '..', 'CHANGELOG.md');
const BROCHURE_PATH = join(
  process.env.USERPROFILE || process.env.HOME,
  'OneDrive - Microsoft', 'Documents', 'deepsky-brochure.html'
);

let brochure, pkg, changelog;
const brochureAvailable = (() => {
  try { readFileSync(BROCHURE_PATH); return true; } catch { return false; }
})();

// Skip all brochure tests on CI where the file doesn't exist (it lives in OneDrive)
const describeIfBrochure = brochureAvailable ? describe : describe.skip;

beforeAll(() => {
  pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
  changelog = readFileSync(CHANGELOG_PATH, 'utf-8');
  if (brochureAvailable) {
    brochure = readFileSync(BROCHURE_PATH, 'utf-8');
  }
});

describeIfBrochure('Brochure exists', () => {
  it('brochure file is readable', () => {
    expect(brochure).not.toBeNull();
    expect(brochure.length).toBeGreaterThan(1000);
  });
});

describeIfBrochure('Version consistency', () => {
  it('download URL contains current package.json version', () => {
    const version = pkg.version;
    const pattern = `DeepSky-Setup-${version}.exe`;
    expect(brochure).toContain(pattern);
  });

  it('download button text shows current version', () => {
    const version = pkg.version;
    expect(brochure).toMatch(new RegExp(`Download v${version.replace(/\./g, '\\.')}`));
  });

  it('"What\'s New" section references current version', () => {
    const version = pkg.version;
    expect(brochure).toMatch(new RegExp(`What.*New.*v${version.replace(/\./g, '\\.')}`));
  });
});

describeIfBrochure('Download links', () => {
  it('download URL points to itsela-ms/DeepSky (primary repo)', () => {
    expect(brochure).toContain('github.com/itsela-ms/DeepSky/releases/download/');
  });

  it('download URL has correct tag format (vX.Y.Z)', () => {
    const version = pkg.version;
    expect(brochure).toContain(`/download/v${version}/DeepSky-Setup-${version}.exe`);
  });

  it('GitHub repo link points to itsela-ms/DeepSky', () => {
    expect(brochure).toMatch(/href="https:\/\/github\.com\/itsela-ms\/DeepSky"/);
  });

  it('releases link points to itsela-ms/DeepSky/releases', () => {
    expect(brochure).toContain('github.com/itsela-ms/DeepSky/releases');
  });

  it('no references to itsela_microsoft (old migration target)', () => {
    expect(brochure).not.toContain('itsela_microsoft');
  });
});

describeIfBrochure('Feature list completeness', () => {
  const requiredFeatures = [
    { keyword: 'sidebar', desc: 'Visual sidebar' },
    { keyword: 'grouping', desc: 'Session grouping' },
    { keyword: 'directory', desc: 'Working directory' },
    { keyword: 'status badge', desc: 'Live status badges' },
    { keyword: 'terminal', desc: 'Multi-tab terminal' },
    { keyword: 'notification', desc: 'Notifications' },
    { keyword: 'Status panel', desc: 'Session Status panel' },
    { keyword: 'theme', desc: 'Catppuccin themes' },
    { keyword: 'tab scroll', desc: 'Tab scroll indicators' },
    { keyword: 'tagging', desc: 'Smart session tagging' },
    { keyword: 'keyboard', desc: 'Keyboard shortcuts' },
    { keyword: 'auto-update', desc: 'Silent auto-updates' },
  ];

  for (const { keyword, desc } of requiredFeatures) {
    it(`lists ${desc}`, () => {
      expect(brochure.toLowerCase()).toContain(keyword.toLowerCase());
    });
  }
});

describeIfBrochure('"What\'s New" section accuracy', () => {
  it('changelog latest version matches brochure "What\'s New" version', () => {
    // Extract first version from changelog
    const changelogMatch = changelog.match(/##\s*\[(\d+\.\d+\.\d+)\]/);
    expect(changelogMatch).not.toBeNull();
    const latestChangelogVersion = changelogMatch[1];

    // Brochure should show the same version
    expect(brochure).toContain(`v${latestChangelogVersion}`);
  });
});

describeIfBrochure('Interactive mock reflects features', () => {
  it('mock has sidebar with Active and History tabs', () => {
    expect(brochure).toContain('data-tab="active"');
    expect(brochure).toContain('data-tab="history"');
  });

  it('mock has search input', () => {
    expect(brochure).toMatch(/mock-search.*Search sessions/i);
  });

  it('mock has session status badges (Working, Waiting, Idle)', () => {
    expect(brochure).toContain('mb-working');
    expect(brochure).toContain('mb-waiting');
    expect(brochure).toContain('mb-idle');
  });

  it('mock has tab bar', () => {
    expect(brochure).toContain('mock-tabbar');
    expect(brochure).toContain('tabBar');
  });

  it('mock has terminal with realistic content', () => {
    expect(brochure).toContain('mock-terminal');
    expect(brochure).toContain('copilot');
  });

  it('mock has status panel with Ctrl+I button', () => {
    expect(brochure).toContain('statusBtn');
    expect(brochure).toMatch(/Ctrl\+I/i);
  });

  it('mock has notification bell with badge', () => {
    expect(brochure).toContain('mock-bell');
    expect(brochure).toContain('bellBadge');
  });

  it('mock has toast notification', () => {
    expect(brochure).toContain('mock-toast');
  });

  it('mock has resource/status panel with PR, Repo, Work Item', () => {
    expect(brochure).toContain('ri-pr');
    expect(brochure).toContain('ri-repo');
    expect(brochure).toContain('ri-wi');
  });

  it('mock has session dot indicators (green, yellow, off)', () => {
    expect(brochure).toContain('dot-green');
    expect(brochure).toContain('dot-yellow');
    expect(brochure).toContain('dot-off');
  });
});

describeIfBrochure('Keyboard shortcuts section', () => {
  it('has a keyboard shortcuts section', () => {
    expect(brochure).toMatch(/Keyboard Shortcuts/i);
  });

  const shortcuts = [
    'Ctrl+N', 'Ctrl+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+Shift+T',
    'Ctrl+I', 'Ctrl+F', 'Escape',
    'Ctrl+C', 'Ctrl+V', 'Shift+Enter',
    'Ctrl+=', 'Ctrl+-', 'Ctrl+0',
  ];

  for (const shortcut of shortcuts) {
    it(`lists ${shortcut}`, () => {
      expect(brochure).toContain(shortcut);
    });
  }
});

describeIfBrochure('Prerequisite info', () => {
  it('mentions GitHub Copilot CLI prerequisite', () => {
    expect(brochure).toMatch(/prerequisite/i);
    expect(brochure).toContain('winget install github.copilot');
  });
});

describeIfBrochure('No stale content', () => {
  it('does not reference removed features (resource panel as standalone)', () => {
    // Resource panel was merged into Status panel in v0.8.0
    // Only check in the feature list section, not in mock JS comments
    const featureSection = brochure.match(/<ul class="feature-list">([\s\S]*?)<\/ul>/);
    if (featureSection) {
      expect(featureSection[1]).not.toMatch(/Resource panel/i);
    }
  });

  it('does not contain placeholder or TODO markers in visible text', () => {
    // Strip HTML tags, script blocks, and CSS to check only visible content + comments
    const withoutScripts = brochure.replace(/<script[\s\S]*?<\/script>/gi, '');
    const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, '');
    const textContent = withoutStyles.replace(/<[^>]*>/g, '');
    expect(textContent).not.toMatch(/\bTODO\b|\bFIXME\b|\bPLACEHOLDER\b|\bXXX\b/i);
  });
});
