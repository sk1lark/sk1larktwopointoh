import { ref } from 'vue';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const useTypewriter = () => {
  const typeText = (element: HTMLElement, onComplete?: () => void) => {
    const text = element.textContent || '';
    element.textContent = '';
    element.style.opacity = '1';
    
    const chars = text.split('');
    let currentIndex = 0;
    
    const typeChar = () => {
      if (currentIndex < chars.length) {
        element.textContent += chars[currentIndex];
        currentIndex++;
        setTimeout(typeChar, 30); // Typing speed
      } else if (onComplete) {
        onComplete();
      }
    };
    
    typeChar();
  };

  const setupScrollTypewriter = (
    selector: string,
    triggerSelector?: string,
    onUpdate?: (text: string) => void,
    sourceText?: string
  ) => {
    console.log('🎭 Setting up scroll typewriter for:', selector);
    
    const elements = document.querySelectorAll(selector);
    console.log('📋 Found elements:', elements.length);
    
    if (elements.length === 0) {
      console.warn('⚠️ No elements found for selector:', selector);
      return;
    }
    
  const element = elements[0] as HTMLElement;
  const originalText = sourceText ?? element.textContent ?? '';
    const chars = originalText.split('');
    
    console.log(`📝 Setting up typewriter, text length: ${chars.length}`);
    
    ScrollTrigger.create({
      trigger: triggerSelector || element,
      start: 'top 80%',
      end: 'bottom 20%',
      scrub: 0.5,
      onUpdate: (self) => {
        const progress = self.progress;
        const charsToShow = Math.floor(progress * chars.length);
        const currentText = chars.slice(0, charsToShow).join('');
        if (onUpdate) {
          onUpdate(currentText);
        } else {
          element.textContent = currentText;
        }
      },
      onLeave: () => {
        if (onUpdate) {
          onUpdate(originalText);
        } else {
          element.textContent = originalText;
        }
      },
    });
  };

  return {
    typeText,
    setupScrollTypewriter,
  };
};
