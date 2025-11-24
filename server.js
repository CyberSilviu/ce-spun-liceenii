const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let questions = [];
try {
    questions = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
} catch (e) {
    questions = [];
}

// Variabilă separată pentru Timer (nu o trimitem la clienți)
let timerInterval = null;

let gameState = {
    gameMode: 'normal',
    isPaused: false, // <--- NOU: Starea de pauză
    currentRoundIndex: 0,
    revealedAnswers: [],
    currentScore: 0,
    teamAScore: 0,
    teamBScore: 0,
    strikes: 0,
    timer: 20,
    bonusBoard: [
        { text: "", points: 0, revealed: false },
        { text: "", points: 0, revealed: false },
        { text: "", points: 0, revealed: false },
        { text: "", points: 0, revealed: false },
        { text: "", points: 0, revealed: false }
    ]
};

io.on('connection', (socket) => {
    socket.emit('init', { questions, state: gameState });
    if(timerInterval) socket.emit('timer_update', gameState.timer);

// 4. PAUZĂ (PLAY / STOP)
    socket.on('toggle_pause', () => {
        gameState.isPaused = !gameState.isPaused;
        io.emit('update_board', gameState);
        
        // Trimitem comanda specifică în funcție de stare
        if (gameState.isPaused) {
            io.emit('play_audio', 'pause_start');
        } else {
            io.emit('play_audio', 'pause_stop');
        }
    });
    // --- LOGICA JOC NORMAL ---
    socket.on('next_round', () => {
        if (gameState.currentRoundIndex < questions.length - 1) {
            gameState.currentRoundIndex++;
            gameState.revealedAnswers = [];
            gameState.currentScore = 0;
            gameState.strikes = 0;
            io.emit('update_board', gameState);
        }
    });

   // 1. REVEAL NORMAL
    socket.on('reveal_answer', (index) => {
        if (!gameState.revealedAnswers.includes(index)) {
            gameState.revealedAnswers.push(index);
            if(questions[gameState.currentRoundIndex] && questions[gameState.currentRoundIndex].answers[index]) {
                gameState.currentScore += questions[gameState.currentRoundIndex].answers[index].points;
            }
            io.emit('update_board', gameState);
            io.emit('play_audio', 'reveal'); // <--- AICI AM ADĂUGAT
        }
    });

   // 2. STRIKE (X)
    socket.on('give_strike', () => {
        if (gameState.strikes < 3) {
            gameState.strikes++;
            io.emit('show_strike', gameState.strikes);
            io.emit('play_audio', 'wrong'); // <--- AICI AM ADĂUGAT
        }
    });
    socket.on('clear_strikes', () => {
        gameState.strikes = 0;
        io.emit('update_board', gameState);
    });

    socket.on('award_points', (team) => {
        if (team === 'A') gameState.teamAScore += gameState.currentScore;
        if (team === 'B') gameState.teamBScore += gameState.currentScore;
        gameState.currentScore = 0;
        io.emit('update_board', gameState);
    });

    // --- LOGICA MOD BONUS ---
    socket.on('enter_bonus_mode', () => {
        gameState.gameMode = 'bonus';
        gameState.timer = 20;
        clearInterval(timerInterval); // Reset timer logic
        timerInterval = null;
        
        // Curățăm tabla bonus
        gameState.bonusBoard = gameState.bonusBoard.map(() => ({ text: "", points: 0, revealed: false }));
        io.emit('update_board', gameState);
        io.emit('timer_update', 20);
    });

    socket.on('enter_normal_mode', () => {
        gameState.gameMode = 'normal';
        io.emit('update_board', gameState);
    });

    // AM MODIFICAT AICI: Primim datele direct la Reveal pentru siguranță
// 3. REVEAL BONUS
    socket.on('reveal_bonus_row', (data) => {
        const idx = data.index;
        gameState.bonusBoard[idx].text = data.text;
        gameState.bonusBoard[idx].points = parseInt(data.points) || 0;
        gameState.bonusBoard[idx].revealed = true;
        gameState.currentScore += gameState.bonusBoard[idx].points;

        io.emit('update_board', gameState);
        io.emit('play_audio', 'reveal'); // <--- AICI AM ADĂUGAT
    });;

    // --- LOGICA TIMER ---
    socket.on('start_timer', () => {
        gameState.timer = 20;
        io.emit('timer_update', gameState.timer);

        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            if (gameState.timer > 0) {
                gameState.timer--;
                io.emit('timer_update', gameState.timer);
            } else {
                clearInterval(timerInterval);
                timerInterval = null;
                io.emit('play_sound', 'buzz');
            }
        }, 1000);
    });

    // --- RESET TOTAL JOC ---
    socket.on('reset_game', () => {
        // Resetăm variabilele de stare la valorile inițiale
        gameState.currentRoundIndex = 0;
        gameState.revealedAnswers = [];
        gameState.currentScore = 0;
        gameState.teamAScore = 0;
        gameState.teamBScore = 0;
        gameState.strikes = 0;
        gameState.gameMode = 'normal';
        gameState.isPaused = false;
        gameState.timer = 20;
        
        // Resetăm tabla bonus
        gameState.bonusBoard = gameState.bonusBoard.map(() => ({ text: "", points: 0, revealed: false }));

        // Oprim timerul dacă rulează
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        // Trimitem noile date către toți clienții (Admin + Display)
        io.emit('update_board', gameState);
        io.emit('timer_update', 20); 
    });
});

server.listen(3000, () => {
    console.log('---------------------------------------------------');
    console.log('JOC PORNIT! Accesează link-urile de mai jos:');
    console.log('');
    console.log('🖥️  ECRAN PUBLIC (Proiector): http://localhost:3000');
    console.log('🎮 PANOU HOST (Admin):       http://localhost:3000/admin.html');
    console.log('---------------------------------------------------');
});