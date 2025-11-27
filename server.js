const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let gameData = { rounds: [], bonus: [] };
try {
    const rawData = fs.readFileSync('questions.json', 'utf8');
    gameData = JSON.parse(rawData);
    console.log("Întrebări încărcate!");
} catch (e) {
    console.error("EROARE JSON:", e.message);
}

let timerInterval = null;

let gameState = {
    gameMode: 'normal',
    isPaused: false,
    currentRoundIndex: 0,
    revealedAnswers: [],
    currentScore: 0,
    teamAScore: 0,
    teamBScore: 0,
    strikes: 0,
    timer: 20,
    bonusScore: 0,
    // 10 sloturi: 0-4 (Jucător 1), 5-9 (Jucător 2)
    bonusBoard: Array(10).fill().map(() => ({ text: "", points: 0, revealed: false }))
};

io.on('connection', (socket) => {
    socket.emit('init', { questions: gameData, state: gameState });
    if(timerInterval) socket.emit('timer_update', gameState.timer);

    // --- NORMAL ---
    socket.on('next_round', () => {
        if (gameData.rounds && gameState.currentRoundIndex < gameData.rounds.length - 1) {
            gameState.currentRoundIndex++;
            gameState.revealedAnswers = [];
            gameState.currentScore = 0;
            gameState.strikes = 0;
            io.emit('update_board', gameState);
        }
    });

    socket.on('reveal_answer', (index) => {
        if (!gameState.revealedAnswers.includes(index)) {
            gameState.revealedAnswers.push(index);
            const q = gameData.rounds[gameState.currentRoundIndex];
            if(q && q.answers[index]) {
                gameState.currentScore += q.answers[index].points;
            }
            io.emit('update_board', gameState);
            io.emit('play_audio', 'reveal');
        }
    });

    socket.on('give_strike', () => {
        if (gameState.strikes < 3) {
            gameState.strikes++;
            io.emit('show_strike', gameState.strikes);
            io.emit('play_audio', 'wrong');
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

    // --- BONUS ---
    socket.on('enter_bonus_mode', () => {
        gameState.gameMode = 'bonus';
        gameState.timer = 20;
        gameState.bonusScore = 0;
        if(timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        // Resetăm cele 10 sloturi
        gameState.bonusBoard = Array(10).fill().map(() => ({ text: "", points: 0, revealed: false }));
        io.emit('update_board', gameState);
        io.emit('timer_update', 20);
        io.emit('stop_audio', 'timer');
    });

    socket.on('enter_normal_mode', () => {
        gameState.gameMode = 'normal';
        io.emit('update_board', gameState);
        io.emit('stop_audio', 'timer');
    });

    socket.on('reveal_bonus_row', (data) => {
        const idx = parseInt(data.index);
        if(gameState.bonusBoard[idx]) {
            gameState.bonusBoard[idx].text = data.text;
            gameState.bonusBoard[idx].points = parseInt(data.points) || 0;
            gameState.bonusBoard[idx].revealed = true;
            
            gameState.bonusScore += gameState.bonusBoard[idx].points; // Adunăm la total
            
            io.emit('update_board', gameState);
            io.emit('play_audio', 'reveal');
        }
    });
    
    socket.on('give_bonus_strike', () => {
        io.emit('show_strike', 1);
        io.emit('play_audio', 'wrong');
    });

    // --- TIMER ---
    socket.on('start_timer', () => {
        gameState.timer = 20;
        io.emit('timer_update', gameState.timer);
        io.emit('play_audio', 'timer');

        if (timerInterval) clearInterval(timerInterval);
        
        timerInterval = setInterval(() => {
            if (gameState.timer > 0) {
                gameState.timer--;
                io.emit('timer_update', gameState.timer);
            } else {
                clearInterval(timerInterval);
                timerInterval = null;
                io.emit('stop_audio', 'timer');
                // Mică întârziere pentru a ne asigura că stop s-a procesat înainte de start
                setTimeout(() => {
                    io.emit('play_audio', 'timer_end'); 
                }, 200);
            }
        }, 1000);
    });

    // --- PAUSE & RESET ---
socket.on('toggle_pause', () => {
        gameState.isPaused = !gameState.isPaused;
        io.emit('update_board', gameState);
        
        if (gameState.isPaused) {
            // Când punem pauză, PORNEȘTE muzica 'pause'
            io.emit('play_audio', 'pause'); 
        } else {
            // Când scoatem pauza, OPREȘTE muzica 'pause'
            io.emit('stop_audio', 'pause');
        }
    });

    socket.on('reset_game', () => {
        gameState.currentRoundIndex = 0;
        gameState.revealedAnswers = [];
        gameState.currentScore = 0;
        gameState.teamAScore = 0;
        gameState.teamBScore = 0;
        gameState.strikes = 0;
        gameState.gameMode = 'normal';
        gameState.isPaused = false;
        gameState.timer = 20;
        gameState.bonusScore = 0;
        gameState.bonusBoard = Array(10).fill().map(() => ({ text: "", points: 0, revealed: false }));

        if (timerInterval) clearInterval(timerInterval);
        io.emit('stop_audio', 'timer');
        io.emit('update_board', gameState);
    });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server pornit!`);
    console.log(`ADMIN: http://localhost:${PORT}/admin.html`);
    console.log(`DISPLAY: http://localhost:${PORT}`);
});