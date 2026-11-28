'use strict';

const appWork = (() => {
  const overlay = document.getElementById('appWorking'),
    message = document.getElementById('appWorkingMessage'),
    active = new Map();

  function paintStatus() {
    overlay.hidden = !active.size;
    const label = [...active.values()].at(-1) ?? '';
    if (message.textContent !== label) message.textContent = label;
  }

  function begin(label) {
    const id = Symbol();
    active.set(id, label);
    paintStatus();
    return () => {
      active.delete(id);
      paintStatus();
    };
  }

  async function run(label, work) {
    const finish = begin(label);
    try {
      // Let the browser paint the status before work occupies the main thread.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return await work();
    } finally {
      finish();
    }
  }

  return { begin, run };
})();
