import * as THREE from 'three';
console.log(' Starting SK1LARK 3D Scrapbook...');
let scene;
let camera;
let renderer;
let book;
let pages = [];
let currentPage = 0;
let isAnimating = false;
const pageData = [
    { title: '@SK1LARK', text: 'HAYDEN PARK\nWriter  Musician  Developer  Artist', sticker: 'image.png', stickerX: 0.3, stickerY: -0.3 },
    { title: 'ABOUT ME', text: 'Creative technologist exploring\nthe intersection of code and art', sticker: 'image2.png', stickerX: -0.4, stickerY: 0.2 },
    { title: 'MUSIC', text: 'Blending electronic beats\nwith organic sounds', sticker: 'image3.png', stickerX: 0.2, stickerY: -0.4 },
    { title: 'DEVELOPMENT', text: 'Building immersive web\nexperiences', sticker: 'image4.png', stickerX: -0.3, stickerY: 0.3 },
    { title: 'ART', text: 'Digital and mixed media\ncreations', sticker: 'image5.png', stickerX: 0.4, stickerY: -0.2 },
    { title: 'PROJECTS', text: 'Check out my latest work\non GitHub', sticker: '6image.png', stickerX: -0.2, stickerY: 0.4 },
    { title: 'CONTACT', text: 'Let\'s create something\namazing together!', sticker: '7image.png', stickerX: 0.1, stickerY: -0.1 }
];
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7e8d7);
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 8);
    camera.lookAt(0, 0, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    const container = document.getElementById('app');
    if (container)
        container.appendChild(renderer.domElement);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);
    book = new THREE.Group();
    scene.add(book);
    const coverGeometry = new THREE.PlaneGeometry(3, 4);
    const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x8A5A44, roughness: 0.8 });
    const frontCover = new THREE.Mesh(coverGeometry, coverMaterial);
    frontCover.position.z = -0.02;
    book.add(frontCover);
    pageData.forEach((data, index) => {
        const page = createPage(data, index);
        pages.push(page);
        book.add(page);
    });
    const backCover = new THREE.Mesh(coverGeometry, coverMaterial);
    backCover.position.z = 0.02 + pages.length * 0.01;
    book.add(backCover);
    setupControls();
    window.addEventListener('resize', onWindowResize);
    updatePageIndicator();
    animate();
}
function createPage(data, index) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1365;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFEF5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#D4E6F1';
    ctx.lineWidth = 2;
    for (let y = 150; y < canvas.height - 100; y += 40) {
        ctx.beginPath();
        ctx.moveTo(100, y);
        ctx.lineTo(canvas.width - 100, y);
        ctx.stroke();
    }
    ctx.strokeStyle = '#A9A9A9';
    ctx.lineWidth = 4;
    ctx.strokeRect(50, 50, canvas.width - 100, canvas.height - 100);
    ctx.fillStyle = '#2C3E50';
    ctx.font = 'bold 80px Permanent Marker';
    ctx.textAlign = 'center';
    ctx.fillText(data.title, canvas.width / 2, 120);
    ctx.font = '48px Indie Flower';
    ctx.fillStyle = '#34495E';
    const lines = data.text.split('\n');
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, 250 + i * 60));
    const texture = new THREE.CanvasTexture(canvas);
    const stickerImg = new Image();
    stickerImg.src = +"ssets/" + ;
    stickerImg.onload = () => {
        const size = 300;
        const x = canvas.width / 2 + data.stickerX * canvas.width - size / 2;
        const y = canvas.height / 2 + data.stickerY * canvas.height - size / 2;
        ctx.save();
        ctx.translate(x + size / 2, y + size / 2);
        ctx.rotate((Math.random() - 0.5) * 0.3);
        ctx.drawImage(stickerImg, -size / 2, -size / 2, size, size);
        ctx.restore();
        texture.needsUpdate = true;
    };
    const material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.7 });
    const geometry = new THREE.PlaneGeometry(3, 4);
    const pageMesh = new THREE.Mesh(geometry, material);
    pageMesh.position.z = index * 0.01;
    return pageMesh;
}
function setupControls() {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'PREV';
    prevBtn.style.cssText = 'position:fixed;bottom:30px;left:30px;padding:15px 30px;font-size:18px;background:#8A5A44;color:white;border:none;border-radius:8px;cursor:pointer;font-family:Permanent Marker;';
    prevBtn.addEventListener('click', () => flipPage(-1));
    document.body.appendChild(prevBtn);
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'NEXT';
    nextBtn.style.cssText = 'position:fixed;bottom:30px;right:30px;padding:15px 30px;font-size:18px;background:#8A5A44;color:white;border:none;border-radius:8px;cursor:pointer;font-family:Permanent Marker;';
    nextBtn.addEventListener('click', () => flipPage(1));
    document.body.appendChild(nextBtn);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft')
            flipPage(-1);
        if (e.key === 'ArrowRight')
            flipPage(1);
    });
}
function updatePageIndicator() {
    let indicator = document.getElementById('page-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'page-indicator';
        indicator.style.cssText = 'position:fixed;top:30px;left:50%;transform:translateX(-50%);padding:10px 20px;background:rgba(0,0,0,0.7);color:white;border-radius:8px;font-family:Permanent Marker;font-size:16px;';
        document.body.appendChild(indicator);
    }
    indicator.textContent = +"Page  / " + ;
}
function flipPage(direction) {
    const newPage = currentPage + direction;
    if (isAnimating || newPage < 0 || newPage >= pageData.length)
        return;
    isAnimating = true;
    currentPage = newPage;
    updatePageIndicator();
    const duration = 1000;
    const startTime = Date.now();
    function doAnimate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        pages.forEach((page, i) => {
            if (direction > 0) {
                if (i < currentPage)
                    page.rotation.y = Math.PI;
                else if (i === currentPage)
                    page.rotation.y = eased * Math.PI;
                else
                    page.rotation.y = 0;
            }
            else {
                if (i < currentPage)
                    page.rotation.y = Math.PI;
                else if (i === currentPage)
                    page.rotation.y = Math.PI - eased * Math.PI;
                else
                    page.rotation.y = 0;
            }
        });
        if (progress < 1)
            requestAnimationFrame(doAnimate);
        else
            isAnimating = false;
    }
    doAnimate();
}
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
function animate() {
    requestAnimationFrame(animate);
    if (!isAnimating)
        book.rotation.y = 0.1 + Math.sin(Date.now() * 0.0005) * 0.05;
    renderer.render(scene, camera);
}
if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
else
    init();
