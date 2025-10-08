<template>
  <div class="page-container">
    <ClientOnly>
      <ThreeScene />
    </ClientOnly>
  </div>
  
</template>

<script setup>
const ThreeScene = defineAsyncComponent(() =>
  import('~/components/ThreeScene.client.vue')
);
// No 2D header; hero visuals are inside the 3D scene

// Bio text is drawn into a CanvasTexture in the 3D scene
</script>

<style scoped>
.page-container {
  width: 100vw;
  min-height: 100vh;
  position: relative;
  overflow: hidden;
}
</style>
