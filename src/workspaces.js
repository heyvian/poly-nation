'use strict';

// Keep the active workspace through a reload in this tab. Saved model data has its own storage.
const WORKSPACE_KEY = 'poly-nation-active-view';
const initialWorkspace = (() => {
  try {
    return sessionStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
})();

function rememberWorkspace(workspace) {
  try {
    sessionStorage.setItem(WORKSPACE_KEY, workspace);
  } catch {
    // Navigation still works when the browser blocks tab storage.
  }
}

// Start after every workspace and its helpers have loaded.
initProgrammingEditor();
initCraneControls();
initGL();
restoreSaved();
initCrossUI();
wheelRender();
update();
document.addEventListener('visibilitychange', () => {
  swingLast = 0;
});
requestAnimationFrame(animateSwingFrame);

// All workspaces share stable navigation. Switching views keeps the model and score in memory.
(() => {
  const rationale = $('designRationale'),
    workspaces = {
      massing: { panel: $('massingPhase'), button: $('openMassing') },
      materials: { panel: $('materialsPhase'), button: $('openMaterials'), title: $('materialsTitle') },
      drawings: { panel: $('drawingsPhase'), button: $('openDrawings'), title: $('drawingsTitle') },
      build: { panel: $('buildPhase'), button: $('openBuild'), title: $('buildTitle') },
      render: { panel: $('renderPhase'), button: $('openRender'), title: $('renderTitle') },
      site: { panel: $('sitePhase'), button: $('openSite'), title: $('siteTitle') },
      climate: { panel: $('climatePhase'), button: $('openClimate'), title: $('climateTitle') },
      print: { panel: $('printPhase'), button: $('openPrint'), title: $('printTitle') },
      rationale: { panel: rationale, button: $('openRationale') }
    },
    pageScroll = { massing: 0, materials: 0, drawings: 0, build: 0, render: 0, site: 0, climate: 0, print: 0, rationale: 0 };
  let activeWorkspace = 'massing',
    lastStudyWorkspace = 'massing';

  function showWorkspace(workspace) {
    if (workspace === activeWorkspace) return;
    pageScroll[activeWorkspace] = window.scrollY;
    if (workspace !== 'rationale') lastStudyWorkspace = workspace;
    for (const [name, { panel, button }] of Object.entries(workspaces)) {
      panel.hidden = name !== workspace;
      if (name === workspace) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    document.body.classList.toggle('materials-open', workspace === 'materials');
    document.body.classList.toggle('dr-open', workspace === 'rationale');
    document.body.classList.toggle('drawings-open', workspace === 'drawings');
    document.body.classList.toggle('build-open', workspace === 'build');
    document.body.classList.toggle('render-open', workspace === 'render');
    document.body.classList.toggle('site-open', workspace === 'site');
    document.body.classList.toggle('climate-open', workspace === 'climate');
    document.body.classList.toggle('print-open', workspace === 'print');
    activeWorkspace = workspace;
    if (workspace === 'materials') materialWorkspace.open();
    if (workspace === 'drawings') {
      if (pending) update();
      openDrawingWorkspace(model, materialWorkspace.assignments());
    }
    if (workspace === 'build') {
      if (pending) update();
      openBuildWorkspace(model, materialWorkspace.assignments());
    }
    if (workspace === 'render') {
      if (pending) update();
      openRenderWorkspace(model, materialWorkspace.assignments());
    }
    if (workspace === 'site') {
      if (pending) update();
      siteWorkspace.open(model, materialWorkspace.assignments());
    }
    if (workspace === 'climate') {
      if (pending) update();
      climateWorkspace.open(model);
    }
    if (workspace === 'print') {
      if (pending) update();
      printWorkspace.open(model);
    }
    if (workspace === 'massing') {
      if (massingSiteRevision !== siteWorkspace.revision) upload(model);
      else requestAnimationFrame(draw);
    }
    window.scrollTo(0, pageScroll[workspace]);
    const { title, button } = workspaces[workspace];
    // Returning to the deck should focus the visible slide and enable its keyboard controls.
    const currentSlide =
      workspace === 'rationale' && rationale.querySelector('.dr-slide[data-current-slide] h2');
    if (currentSlide) currentSlide.tabIndex = -1;
    (currentSlide || title || button).focus({ preventScroll: true });
    rememberWorkspace(workspace);
  }

  for (const [name, { button }] of Object.entries(workspaces))
    button.addEventListener('click', () => showWorkspace(name));
  document.addEventListener('west-village-change', () => {
    if (activeWorkspace === 'massing' && massingSiteRevision !== siteWorkspace.revision) upload(model);
  });
  for (const id of ['drBack', 'drBottomBack'])
    $(id).addEventListener('click', () => showWorkspace(lastStudyWorkspace));
  initRationaleSlides(rationale);
  $('drPrint').addEventListener('click', () => window.print());
  if (Object.hasOwn(workspaces, initialWorkspace)) showWorkspace(initialWorkspace);
})();
