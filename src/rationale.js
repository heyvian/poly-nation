'use strict';

// Keep the jury deck's navigation independent of the lab. Print CSS reveals every topic.
function initRationaleSlides(root) {
  const slides = [...root.querySelectorAll('.dr-hero, article.dr-section')],
    previous = root.querySelector('#drPrevious'),
    next = root.querySelector('#drNext'),
    status = root.querySelector('#drSlideStatus'),
    links = [...root.querySelectorAll('.dr-nav a')];
  const slideId = (slide) => slide.id || slide.querySelector('h2').id;
  let current = 0;
  slides.forEach((slide) => slide.classList.add('dr-slide'));
  root.classList.add('dr-slide-deck');
  function show(index, focus) {
    current = Math.min(slides.length - 1, Math.max(0, index));
    for (const [i, slide] of slides.entries())
      slide.toggleAttribute('data-current-slide', i === current);
    for (const link of links)
      link.setAttribute(
        'aria-current',
        link.hash.slice(1) === slideId(slides[current]) ? 'step' : 'false'
      );
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    status.value = `${current + 1} / ${slides.length}`;
    if (focus) {
      const heading = slides[current].querySelector('h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      root.scrollTop = 0;
      window.scrollTo(0, 0);
    }
  }
  for (const link of links) {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const target = slides.findIndex((slide) => slideId(slide) === link.hash.slice(1));
      if (target >= 0) show(target, true);
    });
  }
  previous.onclick = () => show(current - 1, true);
  next.onclick = () => show(current + 1, true);
  root.addEventListener('keydown', (event) => {
    const positions = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: slides.length - 1
    };
    if (!Object.hasOwn(positions, event.key) || event.altKey || event.ctrlKey || event.metaKey)
      return;
    event.preventDefault();
    show(positions[event.key], true);
  });
  show(
    Math.max(
      0,
      slides.findIndex((slide) => slideId(slide) === location.hash.slice(1))
    ),
    false
  );
}
