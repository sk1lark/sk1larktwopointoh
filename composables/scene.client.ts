import * as THREE from 'three';
import { gsap } from 'gsap';
import { ref, computed } from 'vue';

// Create shared state for 3D objects
const groupState = ref<THREE.Group | null>(null);

export const useScene = () => {
  const group = groupState;
  let renderer: THREE.WebGLRenderer;
  let camera: THREE.PerspectiveCamera;
  let animationId: number;
  let particles: THREE.Points;
  let glassSphere: THREE.Mesh;
  let chromeTorus: THREE.Mesh;
  let blob: THREE.Mesh;
  const scene = new THREE.Scene();

  const mousePosition = { x: 0, y: 0 };
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  const targetRotation = { x: 0, y: 0 };

  const onMouseMove = (event: MouseEvent) => {
    mousePosition.x = (event.clientX / window.innerWidth) * 2 - 1;
    mousePosition.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Interactive drag rotation
    if (isDragging && group.value) {
      const deltaX = event.clientX - previousMousePosition.x;
      const deltaY = event.clientY - previousMousePosition.y;
      
      targetRotation.y += deltaX * 0.008;
      targetRotation.x += deltaY * 0.008;
    } else if (group.value) {
      // Subtle hover effect when not dragging
      gsap.to(group.value.rotation, {
        duration: 1.5,
        x: mousePosition.y * 0.15 + targetRotation.x,
        y: mousePosition.x * 0.15 + targetRotation.y,
        ease: 'power2.out',
      });
    }

    previousMousePosition = { x: event.clientX, y: event.clientY };

    // Camera parallax effect
    if (camera) {
      gsap.to(camera.position, {
        x: mousePosition.x * 0.3,
        y: mousePosition.y * 0.3,
        duration: 1.5,
        ease: 'power2.out',
      });
    }
  };

  const onMouseDown = (event: MouseEvent) => {
    isDragging = true;
    previousMousePosition = { x: event.clientX, y: event.clientY };
    if (group.value) {
      gsap.to(group.value.scale, {
        x: 1.05,
        y: 1.05,
        z: 1.05,
        duration: 0.3,
        ease: 'power2.out',
      });
    }
  };

  const onMouseUp = () => {
    isDragging = false;
    if (group.value) {
      gsap.to(group.value.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: 0.5,
        ease: 'elastic.out(1, 0.5)',
      });
    }
  };

  const init = (container: HTMLElement) => {
    console.log('🎬 Initializing Three.js scene...', container);
    
    // Setup camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 8;

    // Setup renderer
    renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xfaf5ff, 0); // Light transparent background
    container.appendChild(renderer.domElement);
    console.log('✅ Canvas appended to container');

    // Create main 3D group
    const mainGroup = new THREE.Group();
    group.value = mainGroup;
    scene.add(mainGroup);

    // Create liquid glass sphere
    const sphereGeometry = new THREE.SphereGeometry(2, 128, 128);
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0,
      transmission: 1,
      thickness: 0.5,
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0,
    });
    const glassSphere = new THREE.Mesh(sphereGeometry, glassMaterial);
    mainGroup.add(glassSphere);

    // Create chrome torus
    const torusGeometry = new THREE.TorusGeometry(3, 0.8, 32, 100);
    const chromeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1,
      roughness: 0.1,
      envMapIntensity: 2,
    });
    const chromeTorus = new THREE.Mesh(torusGeometry, chromeMaterial);
    chromeTorus.rotation.x = Math.PI / 4;
    mainGroup.add(chromeTorus);

    // Create liquid blob (using icosahedron for organic look)
    const blobGeometry = new THREE.IcosahedronGeometry(1.5, 4);
    const blobMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xa78bfa,
      metalness: 0.5,
      roughness: 0.1,
      transmission: 0.5,
      thickness: 1,
      transparent: true,
      clearcoat: 1,
      clearcoatRoughness: 0,
    });
    const blob = new THREE.Mesh(blobGeometry, blobMaterial);
    blob.position.x = -2;
    blob.position.y = 1;
    mainGroup.add(blob);

    // Create playful colorful particles background
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCnt = 2000;
    const posArray = new Float32Array(particlesCnt * 3);
    const colorArray = new Float32Array(particlesCnt * 3);
    
    const colors = [
      { r: 0.65, g: 0.55, b: 0.98 }, // purple
      { r: 0.93, g: 0.28, b: 0.6 },  // pink
      { r: 0.38, g: 0.65, b: 0.98 }, // blue
      { r: 0.2, g: 0.83, b: 0.6 },   // green
      { r: 0.98, g: 0.75, b: 0.14 }, // yellow
    ];
    
    for (let i = 0; i < particlesCnt; i++) {
      posArray[i * 3] = (Math.random() - 0.5) * 25;
      posArray[i * 3 + 1] = (Math.random() - 0.5) * 25;
      posArray[i * 3 + 2] = (Math.random() - 0.5) * 25;
      
      const color = colors[Math.floor(Math.random() * colors.length)];
      if (color) {
        colorArray[i * 3] = color.r;
        colorArray[i * 3 + 1] = color.g;
        colorArray[i * 3 + 2] = color.b;
      }
    }
    
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.05,
      transparent: true,
      opacity: 0.7,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    });
    particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x6366f1, 2);
    pointLight1.position.set(5, 5, 5);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xec4899, 2);
    pointLight2.position.set(-5, -5, 5);
    scene.add(pointLight2);

    // Animation loop
    const clock = new THREE.Clock();
    
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Liquid glass morphing animation
      if (mainGroup) {
        // Smooth organic rotation
        mainGroup.rotation.y = elapsedTime * 0.15;
        
        // Animate individual objects
        glassSphere.rotation.x = elapsedTime * 0.2;
        glassSphere.rotation.y = elapsedTime * 0.3;
        
        // Pulse the glass sphere
        const pulse = Math.sin(elapsedTime * 2) * 0.1 + 1;
        glassSphere.scale.set(pulse, pulse, pulse);
        
        // Flow the torus
        chromeTorus.rotation.x = Math.PI / 4 + Math.sin(elapsedTime * 0.5) * 0.2;
        chromeTorus.rotation.z = elapsedTime * 0.3;
        
        // Blob morphing effect
        blob.rotation.x = elapsedTime * 0.4;
        blob.rotation.y = elapsedTime * 0.5;
        const blobPulse = Math.sin(elapsedTime * 1.5) * 0.2 + 1;
        blob.scale.set(blobPulse, 1/blobPulse, blobPulse);
      }

      // Animate particles with wave motion
      particles.rotation.y = elapsedTime * 0.05;
      particles.rotation.x = Math.sin(elapsedTime * 0.3) * 0.1;

      // Render
      renderer.render(scene, camera);
    };
    animate();
    console.log('🎨 Three.js scene is now animating!');

    // Handle resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };
    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      renderer.dispose();
      // Cleanup geometries and materials
      if (particles) {
        particles.geometry.dispose();
        if (particles.material instanceof THREE.Material) {
          particles.material.dispose();
        }
      }
    };
  };

  return {
    init,
    onMouseMove,
    onMouseDown,
    onMouseUp,
    mesh: computed(() => group.value),
  };
};
