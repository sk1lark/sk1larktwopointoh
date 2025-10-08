import { gsap } from 'gsap';

export const useSplitText = () => {
  const split = (el: HTMLElement) => {
    const text = el.innerText;
    el.innerHTML = '';
    const chars = text.split('').map((char) => {
      const span = document.createElement('span');
      span.textContent = char;
      span.style.display = 'inline-block';
      if (char === ' ') {
        span.style.width = '0.5em';
      }
      el.appendChild(span);
      return span;
    });
    return chars;
  };

  const animate = (chars: HTMLElement[], stagger = 0.05) => {
    gsap.from(chars, {
      duration: 1,
      y: '100%',
      opacity: 0,
      ease: 'power3.out',
      stagger: stagger,
    });
  };

  return { split, animate };
};
