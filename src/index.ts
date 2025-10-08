import * as THREE from 'three';
// @ts-ignore
import { TWEEN } from 'three/examples/jsm/libs/tween.module.min.js';

console.log('🎨 Starting SK1LARK 3D Scrapbook...');

// --- Interfaces ---
interface PageData {
    title: string;
    text: string;
    sticker: string;
    stickerX: number;
    stickerY: number;
}

// --- Global variables ---
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;
let book: THREE.Group;
let pages: THREE.Group[] = [];
let currentPage = 0;
let isAnimating = false;

// --- Page Content ---
const pageData: PageData[] = [
    { title: '@SK1LARK', text: 'HAYDEN PARK\n\nWriter • Musician\nDeveloper • Artist', sticker: 'image.png', stickerX: 0.3, stickerY: 0.5 },
    { title: 'ABOUT ME', text: 'Creative technologist\nexploring the\nintersection of\ncode and art', sticker: 'image2.png', stickerX: -0.3, stickerY: 0.4 },
    { title: 'MUSIC', text: 'Blending electronic\nbeats with\norganic sounds', sticker: 'image3.png', stickerX: 0.2, stickerY: 0.5 },
    { title: 'DEVELOPMENT', text: 'Building immersive\nweb experiences\nwith modern tech', sticker: 'image4.png', stickerX: -0.3, stickerY: 0.5 },
    { title: 'ART', text: 'Digital and\nmixed media\ncreations', sticker: 'image5.png', stickerX: 0.4, stickerY: 0.4 },
    { title: 'PROJECTS', text: 'Check out my\nlatest work\non GitHub', sticker: '6image.png', stickerX: -0.2, stickerY: 0.5 },
    { title: 'CONTACT', text: "Let's create\nsomething amazing\ntogether!", sticker: '7image.png', stickerX: 0.2, stickerY: 0.5 },
    { title: 'THANK YOU', text: '@sk1lark\ngithub.com/sk1lark', sticker: '8image.png', stickerX: -0.3, stickerY: 0.4 }
];

// --- Initialization ---
function init() {
    console.log('🎨 Initializing 3D Scrapbook Scene...');

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5e6d3);

    // Camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 13);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    const container = document.getElementById('app');
    if (container) {
        container.appendChild(renderer.domElement);
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(2, 5, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xffdab9, 0.4);
    fillLight.position.set(-2, 3, 4);
    scene.add(fillLight);

    createBook();
    setupControls();

    window.addEventListener('resize', onWindowResize);
    animate();
}

// --- Book Creation ---
function createBook() {
    book = new THREE.Group();
    scene.add(book);

    const pageGeometry = new THREE.PlaneGeometry(4, 5.5);
    const totalSpreads = pageData.length / 2;

    // Create a cover
    const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x8A5A44, roughness: 0.8, side: THREE.DoubleSide });
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 5.6), coverMaterial);
    cover.position.z = 0.05;
    book.add(cover);
    
    const backCover = cover.clone();
    backCover.position.z = -(totalSpreads * 0.05);
    book.add(backCover);


    for (let i = 0; i < totalSpreads; i++) {
        const pageGroup = new THREE.Group();

        const frontMaterial = createPageMaterial(pageData[i * 2]);
        const frontPage = new THREE.Mesh(pageGeometry, frontMaterial);
        frontPage.position.x = 2;
        pageGroup.add(frontPage);

        if (pageData[i * 2 + 1]) {
            const backMaterial = createPageMaterial(pageData[i * 2 + 1]);
            const backPage = new THREE.Mesh(pageGeometry, backMaterial);
            backPage.rotation.y = Math.PI;
            backPage.position.x = 2;
            pageGroup.add(backPage);
        }
        
        pageGroup.position.z = -i * 0.05;
        book.add(pageGroup);
        pages.push(pageGroup);
    }
}

// --- Page Material (Texture) Creation ---
function createPageMaterial(data: PageData): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1408; // Match geometry aspect ratio
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#fffef5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Content
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a2b0a';
    
    ctx.font = 'bold 90px "Kalam", cursive';
    ctx.fillText(data.title, canvas.width / 2, 180);

    ctx.font = '52px "Kalam", cursive';
    const lines = data.text.split('\n');
    lines.forEach((line, i) => {
        ctx.fillText(line, canvas.width / 2, 320 + i * 70);
    });

    const texture = new THREE.CanvasTexture(canvas);

    // Sticker
    const stickerImg = new Image();
    stickerImg.crossOrigin = "anonymous";
    stickerImg.src = `assets/${data.sticker}`;
    stickerImg.onload = () => {
        const size = 350;
        const x = canvas.width / 2 + data.stickerX * canvas.width - size / 2;
        const y = canvas.height / 2 + data.stickerY * canvas.height - size / 2;
        
        ctx.save();
        ctx.translate(x + size / 2, y + size / 2);
        ctx.rotate((Math.random() - 0.5) * 0.2);
        ctx.drawImage(stickerImg, -size / 2, -size / 2, size, size);
        ctx.restore();
        
        texture.needsUpdate = true;
    };

    return new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0.1,
    });
}

// --- UI Controls ---
function setupControls() {
    const buttonStyles = `
        position: absolute;
        bottom: 30px;
        padding: 12px 24px;
        font-family: 'Kalam', cursive;
        font-size: 24px;
        background-color: #c2a583;
        color: #fffef5;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 2px 2px 5px rgba(0,0,0,0.2);
        transition: background-color 0.3s;
    `;

    const prevButton = document.createElement('button');
    prevButton.textContent = '< Prev';
    prevButton.style.cssText = buttonStyles + 'left: 30px;';
    prevButton.onclick = () => turnPage('prev');
    document.body.appendChild(prevButton);

    const nextButton = document.createElement('button');
    nextButton.textContent = 'Next >';
    nextButton.style.cssText = buttonStyles + 'right: 30px;';
    nextButton.onclick = () => turnPage('next');
    document.body.appendChild(nextButton);
}

// --- Page Turning Logic ---
function turnPage(direction: 'next' | 'prev') {
    if (isAnimating) return;

    const totalPages = pages.length;
    
    if (direction === 'next') {
        if (currentPage >= totalPages) return;

        isAnimating = true;
        const pageToTurn = pages[currentPage];
        new TWEEN.Tween(pageToTurn.rotation)
            .to({ y: -Math.PI }, 1500)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onComplete(() => {
                currentPage++;
                isAnimating = false;
            })
            .start();
    } else { // 'prev'
        if (currentPage <= 0) return;

        isAnimating = true;
        currentPage--;
        const pageToTurn = pages[currentPage];
        new TWEEN.Tween(pageToTurn.rotation)
            .to({ y: 0 }, 1500)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onComplete(() => {
                isAnimating = false;
            })
            .start();
    }
}

// --- Event Handlers & Animation Loop ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    TWEEN.update();
    renderer.render(scene, camera);
}

// --- Start ---
window.addEventListener('DOMContentLoaded', init);
