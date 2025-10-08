# Loading 3D Models in Three.js (GLTF/GLB)

## Overview
Your portfolio now supports loading actual 3D models using the GLTF/GLB format! This is way better than just using basic geometric shapes.

## How to Use

### 1. Get a 3D Model
You can get free 3D models from:
- **Sketchfab** (https://sketchfab.com) - Tons of free models
- **CGTrader** (https://www.cgtrader.com/free-3d-models)
- **TurboSquid** (https://www.turbosquid.com/Search/3D-Models/free)
- **Poly Pizza** (https://poly.pizza) - Simple low-poly models
- **Ready Player Me** (https://readyplayer.me) - Create your own avatar

### 2. Place Model File
Put your `.glb` or `.gltf` file in the `public/models/` folder:
```
public/
  models/
    my-cool-model.glb
```

### 3. Load the Model in Your Scene

**Example 1: Basic Loading**
```typescript
import { useGLTFLoader } from '~/composables/useGLTFLoader.client';

const { loadModel, updateAnimations } = useGLTFLoader();

// Load your model
const { model, animations, mixer } = await loadModel('/models/my-cool-model.glb', {
  position: { x: 0, y: 0, z: 0 },
  scale: 0.01,  // Make it smaller/bigger
  rotation: { x: 0, y: Math.PI, z: 0 },
  playAnimations: true  // Auto-play animations if the model has them
});

// Add to your scene
scene.add(model);

// In your animation loop
function animate() {
  const delta = clock.getDelta();
  updateAnimations(delta);  // Updates all model animations
  renderer.render(scene, camera);
}
```

**Example 2: Multiple Models**
```typescript
// Load multiple models at once
const models = await Promise.all([
  loadModel('/models/model1.glb', { position: { x: -2, y: 0, z: 0 } }),
  loadModel('/models/model2.glb', { position: { x: 2, y: 0, z: 0 } }),
  loadModel('/models/model3.glb', { position: { x: 0, y: 2, z: 0 } }),
]);

models.forEach(({ model }) => scene.add(model));
```

**Example 3: Interactive Model**
```typescript
const { model } = await loadModel('/models/character.glb');

// Make it spin on hover
model.traverse((child) => {
  if (child instanceof THREE.Mesh) {
    child.userData.onHover = () => {
      gsap.to(model.rotation, { y: '+=6.28', duration: 1 });
    };
  }
});
```

## Updating Your Scene

To add GLTF model loading to your existing `scene.client.ts`, add this code in the `init` function:

```typescript
import { useGLTFLoader } from '~/composables/useGLTFLoader.client';

const init = async (container: HTMLElement) => {
  // ... existing setup code ...
  
  // Load your 3D models
  const { loadModel, updateAnimations } = useGLTFLoader();
  
  try {
    const { model } = await loadModel('/models/my-model.glb', {
      position: { x: 0, y: -1, z: 0 },
      scale: 2,
      playAnimations: true
    });
    
    mainGroup.add(model);
  } catch (error) {
    console.error('Failed to load model:', error);
  }
  
  // Animation loop
  const clock = new THREE.Clock();
  const animate = () => {
    const delta = clock.getDelta();
    updateAnimations(delta);  // <-- Add this line
    
    // ... rest of your animation code ...
  };
};
```

## Model Tips

### File Format
- **GLB** (recommended): Binary, smaller file size, everything in one file
- **GLTF**: JSON format, can have separate texture files

### Optimization
- Keep models under 10MB for web
- Use Draco compression for smaller files
- Reduce polygon count if possible
- Optimize textures (use .webp or compressed JPEGs)

### Finding Good Models
- Search for "low poly" models for better performance
- Look for models with PBR materials (look more realistic)
- Check the license before using!

### Scale Issues?
Models often come in different scales. Common fixes:
```typescript
scale: 0.01   // If model is too big
scale: 100    // If model is too small
scale: { x: 1, y: 2, z: 1 }  // Stretch in one direction
```

### Materials Look Wrong?
The model might need better lighting:
```typescript
// Add environment map
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(
  new RoomEnvironment(), 
  0.04
).texture;
```

## Example Scene Structure
```
project/
  public/
    models/
      character.glb
      object1.glb
      object2.glb
  composables/
    scene.client.ts          # Main scene
    useGLTFLoader.client.ts  # Model loader utility
```

## Troubleshooting

**Model doesn't appear?**
- Check browser console for errors
- Verify file path is correct (`/models/` not `./models/`)
- Try adjusting camera position or model scale
- Check if model needs rotation

**Animations don't play?**
- Set `playAnimations: true`
- Check if model actually has animations
- Make sure you're calling `updateAnimations(delta)` in animation loop

**Performance issues?**
- Reduce polygon count in Blender/3D software
- Use Draco compression
- Load models on scroll/demand instead of immediately
- Use Level of Detail (LOD) for distant objects

## Resources
- Three.js GLTF Examples: https://threejs.org/examples/?q=gltf
- GLTF Format Info: https://www.khronos.org/gltf/
- glTF Viewer: https://gltf-viewer.donmccurdy.com/
