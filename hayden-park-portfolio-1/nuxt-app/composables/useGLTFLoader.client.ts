import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export const useGLTFLoader = () => {
  const loadModel = async (
    scene: THREE.Scene,
    url: string,
    options: {
      position?: [number, number, number];
      scale?: number;
      rotation?: [number, number, number];
    } = {}
  ) => {
    const loader = new GLTFLoader();
    
    // Setup Draco decoder for compressed models
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);

    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;

      // Apply options
      if (options.position) {
        model.position.set(...options.position);
      }
      if (options.scale) {
        model.scale.setScalar(options.scale);
      }
      if (options.rotation) {
        model.rotation.set(...options.rotation);
      }

      scene.add(model);
      return { model, animations: gltf.animations };
    } catch (error) {
      console.error('Error loading GLTF model:', error);
      throw error;
    }
  };

  return { loadModel };
};
