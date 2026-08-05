<!DOCTYPE html>
<html lang="en">
<head>
   <meta charset="UTF-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
   <title>Dux-Soup High Fly</title>
   <script src="https://cdn.tailwindcss.com"></script>
   <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.4.2/p5.min.js"></script>
   <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;700&display=swap" rel="stylesheet">
   <style>
       body, html {
           margin: 0;
           padding: 0;
           width: 100%;
           height: 100%;
           overflow: hidden;
           font-family: 'Inter', sans-serif;
           user-select: none;
           -webkit-user-select: none;
           -webkit-tap-highlight-color: transparent;
           background-color: #000;
       }
       canvas {
           display: block;
           margin: 0;
           z-index: 0;
       }
       .pixel-font {
           font-family: 'Press Start 2P', cursive;
       }
   </style>
</head>
<body>

   <div id="name-modal" class="absolute inset-0 w-full h-full bg-black/50 items-center justify-center z-50 hidden">
       <div class="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-11/12 max-w-sm text-center">
           <h2 class="pixel-font text-2xl text-blue-600 dark:text-blue-400 mb-4">New High Score!</h2>
           <p class="mb-4 text-gray-700 dark:text-gray-200">Enter your name for the leaderboard:</p>
           
           <div id="input-container" class="hidden">
                <input type="text" id="name-input" class="w-full p-2 border-2 border-gray-300 rounded-md mb-4" placeholder="Your Name" maxlength="10">
                <button id="submit-score-btn" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">Submit</button>
           </div>
           
           <button id="show-keyboard-btn" class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg">Tap to Enter Name</button>
       </div>
   </div>

<script type="module">
       import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
       import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
       import { getFirestore, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

       const firebaseConfig = {
           apiKey: "AIzaSyAn0TNTy9gxmIcr8n90M8yOz3-RyVU8yrU",
           authDomain: "highflygame-1ac8f.firebaseapp.com",
           projectId: "highflygame-1ac8f",
           storageBucket: "highflygame-1ac8f.firebasestorage.app",
           messagingSenderId: "850289020856",
           appId: "1:850289020856:web:211aa43351e86d39fe494d",
           measurementId: "G-02MMXM7KJ9"
       };
       const app = initializeApp(firebaseConfig);
       const auth = getAuth(app);
       const db = getFirestore(app);

       const appId = 'highflygame-1ac8f';

       const nameModal = document.getElementById('name-modal');
       const nameInput = document.getElementById('name-input');
       const submitScoreBtn = document.getElementById('submit-score-btn');
       const showKeyboardBtn = document.getElementById('show-keyboard-btn');
       const inputContainer = document.getElementById('input-container');

       let leaderboardDayRef, leaderboardNightRef;
       let localLeaderboardDay = [];
       let localLeaderboardNight = [];
       let newHighScore = null;

       const handleSubmit = async () => {
           if (!newHighScore) return;
           const name = nameInput.value.trim() || 'Anonymous';
           newHighScore.name = name;
           const isNightMode = newHighScore.isNightMode;
           const relevantLeaderboard = isNightMode ? localLeaderboardNight : localLeaderboardDay;
           const relevantRef = isNightMode ? leaderboardNightRef : leaderboardDayRef;
           const updatedScores = [...relevantLeaderboard, newHighScore].sort((a, b) => b.score - a.score).slice(0, 10);
           try {
               await setDoc(relevantRef, { scores: updatedScores });
           } catch (error) {
               console.error("Error writing to leaderboard: ", error);
           }
           nameModal.classList.add('hidden');
           nameModal.classList.remove('flex');
           newHighScore = null;
           nameInput.value = '';
           // Restore the buttons to the initial state for next time
           inputContainer.classList.add('hidden');
           showKeyboardBtn.classList.remove('hidden');
           window.p5.resetGameAfterScoreSubmit();
           window.p5.loop();
       };

       const checkHighScore = (score, isNightMode) => {
           if (score === 0) return false;
           const relevantLeaderboard = isNightMode ? localLeaderboardNight : localLeaderboardDay;
           const lowestScore = relevantLeaderboard.length > 0 ? relevantLeaderboard[relevantLeaderboard.length - 1].score : 0;
           if (score > lowestScore || relevantLeaderboard.length < 10) {
               newHighScore = { score, isNightMode };
               nameModal.classList.remove('hidden');
               nameModal.classList.add('flex');
               window.p5.noLoop();
               return true;
           }
           return false;
       };
       window.checkHighScore = checkHighScore;

       function setupLeaderboardListeners() {
           let dayDataReceived = false, nightDataReceived = false, initialLoadSignaled = false;
           const signalReady = () => {
               if (dayDataReceived && nightDataReceived && !initialLoadSignaled) {
                   initialLoadSignaled = true;
                   if (window.p5 && typeof window.p5.firebaseReady === 'function') {
                       window.p5.firebaseReady();
                   }
               }
           };
           leaderboardDayRef = doc(db, `artifacts/${appId}/public/data/leaderboard/day_mode`);
           onSnapshot(leaderboardDayRef, (doc) => {
               localLeaderboardDay = doc.exists() ? doc.data().scores || [] : [];
               dayDataReceived = true;
               if (window.p5) window.p5.setLeaderboards(localLeaderboardDay, localLeaderboardNight);
               signalReady();
           });
           leaderboardNightRef = doc(db, `artifacts/${appId}/public/data/leaderboard/night_mode`);
           onSnapshot(leaderboardNightRef, (doc) => {
               localLeaderboardNight = doc.exists() ? doc.data().scores || [] : [];
               nightDataReceived = true;
               if (window.p5) window.p5.setLeaderboards(localLeaderboardDay, localLeaderboardNight);
               signalReady();
           });
       }
       
       // --- EVENT LISTENERS ---
       showKeyboardBtn.addEventListener('click', () => {
           showKeyboardBtn.classList.add('hidden');
           inputContainer.classList.remove('hidden');
           nameInput.focus(); // This will now work reliably
       });

       submitScoreBtn.addEventListener('click', handleSubmit);
       nameInput.addEventListener('keyup', (event) => {
           if (event.key === 'Enter') handleSubmit();
       });
       
       onAuthStateChanged(auth, (user) => {
           if (user) {
               setupLeaderboardListeners();
           } else {
               signInAnonymously(auth);
           }
       });
   </script>

   <script>
       // Your p5.js game code remains the same...
       const DEPLOY_VERSION = '1.2.0';
       let bird;
       let birdImg;
       let pipes = [];
       let score = 0;
       let gameState = 'loading'; // Start in loading state
       let clouds = [];
       let midnightMode = false;
       let rain = [];
       let flashTimer = 0;
       let confetti = [];
       let leaderboardDayData = [];
       let leaderboardNightData = [];
       window.p5 = this;
       this.setLeaderboards = (dayData, nightData) => {
           leaderboardDayData = dayData;
           leaderboardNightData = nightData;
       }
       this.resetGameAfterScoreSubmit = () => {
            gameState = 'over';
       }
       this.firebaseReady = () => {
           if (gameState === 'loading') {
               gameState = 'start';
           }
       }
       function preload() {
           birdImg = loadImage("https://i.imgur.com/3erQEDH.png");
       }
       function setup() {
           const canvas = createCanvas(windowWidth, windowHeight);
           bird = new Bird();
           for (let i = 0; i < 5; i++) {
               clouds.push(new Cloud(random(width), random(height * 0.1, height * 0.5)));
           }
       }
       function windowResized() {
           resizeCanvas(windowWidth, windowHeight);
           bird.baseY = height / 2;
           bird.reset();
       }
       function draw() {
           if (midnightMode) { background(15, 23, 42); } 
           else { background(135, 206, 235); }

           if (gameState === 'loading') {
               drawLoadingScreen();
               return;
           }
           if (!midnightMode) drawScenery();

           if (gameState === 'start') {
               for (let cloud of clouds) { cloud.show(); }
               bird.hover();
               bird.show();
               drawStartScreen();
           } else if (gameState === 'play') {
               for (let cloud of clouds) { cloud.show(); cloud.update(); }
               if (midnightMode) {
                   if (random() < 0.01 && flashTimer <= 0) flashTimer = 3;
                   if (flashTimer > 0) { background(200, 200, 255, 150); flashTimer--; }
                   for (let i = 0; i < 3; i++) { rain.push(new Rain(random(width), random(-100, 0))); }
                   for (let i = rain.length - 1; i >= 0; i--) { rain[i].fall(); rain[i].show(); if (rain[i].offscreen()) rain.splice(i, 1); }
               }
               for (let p of pipes) { p.show(); }
               for (let c of confetti) { c.show(); c.update(); }
               bird.show();
               playGame();
               bird.update();
               fill(255);
               stroke(0);
               strokeWeight(4);
               let size = height * 0.05;
               textSize(size);
               textFont('Press Start 2P');
               textAlign(CENTER, TOP);
               text(score, width / 2, 20);
           } else if (gameState === 'over' || gameState === 'entering_name') {
               for (let cloud of clouds) { cloud.show(); }
               if (midnightMode) { for (let i = rain.length - 1; i >= 0; i--) { rain[i].show(); } }
               for (let p of pipes) { p.show(); }
               for (let c of confetti) { c.show(); }
               bird.show();
               if (gameState === 'over') {
                   drawGameOverScreen();
               }
           } else if (gameState === 'leaderboard') {
               for (let cloud of clouds) { cloud.show(); }
               drawLeaderboardScreen();
           }
       }
       function drawLoadingScreen() {
           background(30, 30, 30);
           textAlign(CENTER, CENTER);
           textFont('Press Start 2P');
           textSize(height * 0.05);
           fill(255);
           text('Loading...', width / 2, height / 2);
       }
       function drawScenery() {
           fill(34, 139, 34);
           noStroke();
           rect(0, height - 50, width, 50);
           fill(255, 223, 0);
           ellipse(width * 0.9, height * 0.15, width * 0.1);
       }
       function drawStartScreen() {
           textAlign(CENTER, CENTER);
           textFont('Press Start 2P');
           let titleSize = width * 0.06;
           textSize(titleSize);
           fill(0, 105, 114);
           text('Dux-Soup\nHIGH FLY', width / 2 + 5, height / 4 + 5);
           fill(46, 160, 214);
           stroke(255);
           strokeWeight(5);
           text('Dux-Soup\nHIGH FLY', width / 2, height / 4);
           let btnWidth = width * 0.5;
           let btnHeight = height * 0.08;
           drawButton("Start Flying", width / 2, height * 0.65, btnWidth, btnHeight);
           drawButton("Midnight Flight", width / 2, height * 0.65 + btnHeight + 20, btnWidth, btnHeight);
           drawButton("Leaderboard", width / 2, height * 0.65 + (btnHeight + 20) * 2, btnWidth, btnHeight);
           noStroke();
           fill(255);
           textSize(12);
           textAlign(RIGHT, BOTTOM);
           text(`v${DEPLOY_VERSION}`, width - 10, height - 10);
       }
       function drawGameOverScreen() {
           fill(0, 0, 0, 150);
           rect(0, 0, width, height);
           textFont('Press Start 2P');
           textAlign(CENTER, CENTER);
           let titleSize = height * 0.08;
           textSize(titleSize);
           fill(255);
           text('Game Over', width/2, height * 0.3);
           let scoreSize = height * 0.05;
           textSize(scoreSize);
           text(`Score: ${score}`, width/2, height * 0.45);
           let btnWidth = width * 0.5;
           let btnHeight = height * 0.08;
           drawButton("Fly Again", width / 2, height * 0.7, btnWidth, btnHeight);
           if (midnightMode) {
               drawButton("Day Flight", width / 2, height * 0.7 + btnHeight + 20, btnWidth, btnHeight);
           } else {
               drawButton("Midnight Flight", width / 2, height * 0.7 + btnHeight + 20, btnWidth, btnHeight);
           }
           drawButton("Leaderboard", width / 2, height * 0.7 + (btnHeight + 20) * 2, btnWidth, btnHeight);
       }
       function drawLeaderboardScreen() {
           fill(0, 0, 0, 150);
           rect(0, 0, width, height);
           textFont('Press Start 2P');
           textAlign(CENTER, CENTER);
           let leadSize = height * 0.025;
           textSize(leadSize);
           fill(255, 215, 0);
           text('--- DAY FLIGHT ---', width * 0.25, height * 0.15);
           text('--- MIDNIGHT FLIGHT ---', width * 0.75, height * 0.15);
           let entrySize = height * 0.02;
           textSize(entrySize);
           fill(255);
           textAlign(LEFT, CENTER);
           for(let i = 0; i < leaderboardDayData.length; i++) {
               let y = height * 0.25 + i * (entrySize + 10);
               text(`${i+1}. ${leaderboardDayData[i].name}`, width * 0.1, y);
               textAlign(RIGHT, CENTER);
               text(leaderboardDayData[i].score, width * 0.4, y);
               textAlign(LEFT, CENTER);
           }
           for(let i = 0; i < leaderboardNightData.length; i++) {
               let y = height * 0.25 + i * (entrySize + 10);
               text(`${i+1}. ${leaderboardNightData[i].name}`, width * 0.6, y);
               textAlign(RIGHT, CENTER);
               text(leaderboardNightData[i].score, width * 0.9, y);
               textAlign(LEFT, CENTER);
           }
           let btnWidth = width * 0.5;
           let btnHeight = height * 0.08;
           drawButton("Back", width / 2, height * 0.85, btnWidth, btnHeight);
       }
       function drawButton(txt, x, y, w, h) {
           stroke(255);
           strokeWeight(3);
           fill(0, 128, 255);
           rectMode(CENTER);
           rect(x, y, w, h, 10);
           fill(255);
           noStroke();
           textFont('Inter');
           textSize(h * 0.4);
           textAlign(CENTER, CENTER);
           text(txt, x, y);
           rectMode(CORNER);
       }
       function playGame() {
           let interval = midnightMode ? max(30, 90 - floor(score / 10)) : 90;
            if (frameCount % interval === 0) {
               pipes.push(new Pipe());
           }
           for (let i = pipes.length - 1; i >= 0; i--) {
               pipes[i].update();
               if (pipes[i].hits(bird)) {
                   endGame();
               }
               if (!pipes[i].passed && pipes[i].x + pipes[i].w < bird.x) {
                   pipes[i].passed = true;
                   score += 5;
                   if (score > 0 && score % 50 === 0) launchConfetti();
               }
               if (pipes[i].offscreen()) {
                   pipes.splice(i, 1);
               }
           }
           if (bird.y > height - bird.size / 2 || bird.y < bird.size / 2) {
               endGame();
           }
       }
       function endGame() {
           if (gameState === 'over' || gameState === 'entering_name') return;
           if (window.checkHighScore(score, midnightMode)) {
               gameState = 'entering_name';
           } else {
               gameState = 'over';
           }
       }
   // NEW FIXED CODE
function mousePressed() {
    // If the name input modal is active, do nothing.
    // This allows the browser to process the tap on the HTML button.
    if (gameState === 'entering_name') {
        return;
    }

    // Otherwise, handle the tap as part of the game.
    handleInput();
    return false;
}
       function keyPressed() {
           if (key === ' ') {
               if (gameState === 'play') {
                   bird.up();
               } else if (gameState === 'start' || gameState === 'over') {
                   startGame();
               }
           }
       }
       function handleInput() {
           if (gameState === 'play' || gameState === 'entering_name') {
               if(gameState === 'play') bird.up();
               return;
           }
           let btnWidth, btnHeight;
           if (gameState === 'start') {
               btnWidth = width * 0.5;
               btnHeight = height * 0.08;
               if (mouseX > width/2 - btnWidth/2 && mouseX < width/2 + btnWidth/2 && mouseY > height*0.65 - btnHeight/2 && mouseY < height*0.65 + btnHeight/2) {
                   midnightMode = false;
                   startGame();
               }
               if (mouseX > width/2 - btnWidth/2 && mouseX < width/2 + btnWidth/2 && mouseY > height*0.65 + btnHeight + 20 - btnHeight/2 && mouseY < height*0.65 + btnHeight + 20 + btnHeight/2) {
                   midnightMode = true;
                   startGame();
               }
               if (mouseX > width/2 - btnWidth/2 && mouseX < width/2 + btnWidth/2 && mouseY > height*0.65 + (btnHeight + 20) * 2 - btnHeight/2 && mouseY < height*0.65 + (btnHeight + 20) * 2 + btnHeight/2) {
                   gameState = 'leaderboard';
               }
           } else if (gameState === 'over') {
               btnWidth = width * 0.5;
               btnHeight = height * 0.08;
               if (mouseX > width/2 - btnWidth/2 && mouseX < width/2 + btnWidth/2 && mouseY > height*0.7 - btnHeight/2 && mouseY < height*0.7 + btnHeight/2) {
                   startGame();
               }
               if (mouseX > width/2 - btnWidth/2 && mouseX < width/2 + btnWidth/2 && mouseY > height*0.7 + btnHeight + 20 - btnHeight/2 && mouseY < height*0.7 + btnHeight + 20 + btnHeight/2) {
                   midnightMode = !midnightMode;
                   startGame();
               }
                if (mouseX > width/2 - btnWidth/2 && mouseX < width/2 + btnWidth/2 && mouseY > height*0.7 + (btnHeight + 20) * 2 - btnHeight/2 && mouseY < height*0.7 + (btnHeight + 20) * 2 + btnHeight/2) {
                   gameState = 'leaderboard';
               }
           } else if (gameState === 'leaderboard') {
               btnWidth = width * 0.5;
               btnHeight = height * 0.08;
               if (mouseX > width/2 - btnWidth/2 && mouseX < width/2 + btnWidth/2 && mouseY > height*0.85 - btnHeight/2 && mouseY < height*0.85 + btnHeight/2) {
                   gameState = 'start';
               }
           }
       }
       function startGame() {
           gameState = 'play';
           pipes = [];
           confetti = [];
           score = 0;
           bird.reset();
           pipes.push(new Pipe());
       }
       class Bird {
           constructor() { this.size = height * 0.08; this.reset(); }
           reset() { this.size = height * 0.08; this.x = width / 4; this.y = height / 2; this.gravity = 0.0005 * height; this.lift = -0.012 * height; this.velocity = 0; this.baseY = height / 2; }
           update() { this.velocity += this.gravity; this.velocity *= 0.98; this.y += this.velocity; }
           hover() { this.x = width / 2; this.y = this.baseY + sin(frameCount * 0.05) * 10; this.velocity = 0; }
           show() { push(); translate(this.x, this.y); let angle = map(this.velocity, -10, 15, -PI / 4, PI / 4); if (gameState !== 'play') angle = 0; rotate(angle); imageMode(CENTER); image(birdImg, 0, 0, this.size, this.size); pop(); }
           up() { this.velocity = this.lift; }
       }
       class Pipe {
           constructor() { this.spacing = height * 0.3; this.top = random(height * 0.2, height - this.spacing - (height * 0.2)); this.bottom = height - (this.top + this.spacing); this.x = width; this.w = width * 0.1; this.speed = width * 0.005; this.passed = false; this.color1 = color(110, 200, 60); this.color2 = color(70, 150, 40); }
           show() { noStroke(); for(let i = 0; i < this.w; i++){ let inter = map(i, 0, this.w, 0, 1); let c = lerpColor(this.color1, this.color2, inter); fill(c); rect(this.x + i, 0, 1, this.top); rect(this.x + i, height - this.bottom, 1, this.bottom); } fill(this.color2); rect(this.x - 5, this.top - 25, this.w + 10, 25); rect(this.x - 5, height - this.bottom, this.w + 10, 25); }
           update() { this.x -= this.speed; if (midnightMode) { this.speed *= 1.0005; } }
           offscreen() { return this.x < -this.w; }
           hits(bird) { let r = bird.size / 4; if (bird.y - r < this.top || bird.y + r > height - this.bottom) { if (bird.x + r > this.x && bird.x - r < this.x + this.w) { return true; } } return false; }
       }
       class Cloud {
           constructor(x, y) { this.x = x; this.y = y; this.speed = random(0.2, 0.8); this.size = random(width * 0.1, width * 0.2); }
           show() { fill(midnightMode ? 150 : 255, 180); noStroke(); ellipse(this.x, this.y, this.size, this.size * 0.7); }
           update() { this.x -= this.speed; if (midnightMode) { this.speed *= 1.0005; } if (this.x < -this.size) this.x = width + this.size; }
       }
       class Rain {
           constructor(x, y) { this.x = x; this.y = y; this.len = random(10, 20); this.speed = random(6, 12); }
           fall() { this.y += this.speed; }
           show() { stroke(200, 200, 255, 150); strokeWeight(2); line(this.x, this.y, this.x, this.y + this.len); }
           offscreen() { return this.y > height; }
       }
       class Confetti {
           constructor(x, y) { this.x = x; this.y = y; this.size = random(5, 10); this.color = random([color(255,100,100),color(100,255,100),color(255,255,100),color(100,255,255)]); this.speedY = random(1, 4); this.speedX = random(-2, 2); }
           update() { this.y += this.speedY; this.x += this.speedX; }
           show() { fill(this.color); noStroke(); ellipse(this.x, this.y, this.size); }
           offscreen() { return this.y > height; }
       }
       function launchConfetti() {
           for (let i = 0; i < 100; i++) {
               confetti.push(new Confetti(bird.x, bird.y));
           }
       }
   </script>
</body>
</html>