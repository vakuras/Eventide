import { describe, it, expect } from 'vitest';

// Mirrors the settings tab switching logic in renderer.js.
// Each tab has dataset.settingsTab; each panel has dataset.settingsPanel.
// Clicking a tab sets 'active' on the matching tab+panel and removes it from all others.
function switchSettingsTab(targetName, tabs, panels) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.settingsTab === targetName));
  panels.forEach(p => p.classList.toggle('active', p.dataset.settingsPanel === targetName));
}

function makeTab(name, active = false) {
  const classes = new Set(active ? ['settings-tab', 'active'] : ['settings-tab']);
  return {
    dataset: { settingsTab: name },
    classList: {
      toggle(cls, force) { force ? classes.add(cls) : classes.delete(cls); },
      contains(cls) { return classes.has(cls); },
    },
  };
}

function makePanel(name, active = false) {
  const classes = new Set(active ? ['settings-tab-panel', 'active'] : ['settings-tab-panel']);
  return {
    dataset: { settingsPanel: name },
    classList: {
      toggle(cls, force) { force ? classes.add(cls) : classes.delete(cls); },
      contains(cls) { return classes.has(cls); },
    },
  };
}

const TAB_NAMES = ['general', 'updates', 'shortcuts', 'about'];

function makeSettingsUI(initialActive = 'general') {
  const tabs = TAB_NAMES.map(n => makeTab(n, n === initialActive));
  const panels = TAB_NAMES.map(n => makePanel(n, n === initialActive));
  return { tabs, panels };
}

describe('settings tab switching', () => {
  it('activates the clicked tab', () => {
    const { tabs, panels } = makeSettingsUI();
    switchSettingsTab('updates', tabs, panels);
    expect(tabs.find(t => t.dataset.settingsTab === 'updates').classList.contains('active')).toBe(true);
  });

  it('activates the matching panel', () => {
    const { tabs, panels } = makeSettingsUI();
    switchSettingsTab('updates', tabs, panels);
    expect(panels.find(p => p.dataset.settingsPanel === 'updates').classList.contains('active')).toBe(true);
  });

  it('deactivates all other tabs', () => {
    const { tabs, panels } = makeSettingsUI();
    switchSettingsTab('shortcuts', tabs, panels);
    const others = tabs.filter(t => t.dataset.settingsTab !== 'shortcuts');
    others.forEach(t => expect(t.classList.contains('active')).toBe(false));
  });

  it('deactivates all other panels', () => {
    const { tabs, panels } = makeSettingsUI();
    switchSettingsTab('shortcuts', tabs, panels);
    const others = panels.filter(p => p.dataset.settingsPanel !== 'shortcuts');
    others.forEach(p => expect(p.classList.contains('active')).toBe(false));
  });

  it('switching tabs multiple times always tracks last selection', () => {
    const { tabs, panels } = makeSettingsUI();
    switchSettingsTab('updates', tabs, panels);
    switchSettingsTab('about', tabs, panels);
    switchSettingsTab('general', tabs, panels);
    expect(tabs.find(t => t.dataset.settingsTab === 'general').classList.contains('active')).toBe(true);
    expect(panels.find(p => p.dataset.settingsPanel === 'general').classList.contains('active')).toBe(true);
    expect(tabs.find(t => t.dataset.settingsTab === 'about').classList.contains('active')).toBe(false);
  });

  it('exactly one tab is active after switch', () => {
    const { tabs, panels } = makeSettingsUI();
    switchSettingsTab('about', tabs, panels);
    const activeTabs = tabs.filter(t => t.classList.contains('active'));
    const activePanels = panels.filter(p => p.classList.contains('active'));
    expect(activeTabs).toHaveLength(1);
    expect(activePanels).toHaveLength(1);
  });

  it('switching to already-active tab keeps it active', () => {
    const { tabs, panels } = makeSettingsUI('general');
    switchSettingsTab('general', tabs, panels);
    expect(tabs.find(t => t.dataset.settingsTab === 'general').classList.contains('active')).toBe(true);
    expect(panels.find(p => p.dataset.settingsPanel === 'general').classList.contains('active')).toBe(true);
  });
});
