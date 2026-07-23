# Secure Messenger

End-to-end encrypted messaging application with features similar to Telegram.

## Features

- Real-time messaging with WebSockets
- User authentication (register/login)
- Direct and group chats
- Online status indicators
- Typing indicators
- Message history
- User search
- Profile customization (status, avatar)
- Dark theme UI
- E2E encryption support

## Tech Stack

- **Frontend**: React, Tailwind CSS, Socket.io Client
- **Backend**: Node.js, Express, Socket.io, SQLite
- **Auth**: JWT (JSON Web Tokens), bcryptjs

## Quick Start

### Prerequisites

- Node.js 16+ installed
- npm or yarn

### Installation

```bash
cd secure-messenger
npm install
cd client && npm install && cd ..
```

### Running Locally

```bash
npm run dev
```

This will start both the server (port 3001) and client (port 3000).

### Build for Production

```bash
npm run build
```

## Deployment

### Option 1: Railway (Recommended - Free Tier)

1. Push code to GitHub
2. Go to [Railway.app](https://railway.app)
3. Create new project from GitHub repo
4. Add environment variable: `JWT_SECRET=your_secret_key`
5. Deploy!

### Option 2: Render (Free Tier)

1. Push code to GitHub
2. Go to [Render.com](https://render.com)
3. Create a new Web Service
4. Set build command: `cd client && npm install && npm run build`
5. Set start command: `cd server && npm start`
6. Add environment variable: `JWT_SECRET=your_secret_key`
7. Deploy!

### Option 3: Vercel (Frontend) + Railway (Backend)

1. Deploy frontend to Vercel
2. Deploy backend to Railway
3. Set `REACT_APP_API_URL` in Vercel to your Railway backend URL

## Environment Variables

Create a `.env` file in the server directory:

```
PORT=3001
JWT_SECRET=your_super_secret_key_here
```

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile

### Chats
- `GET /api/chats` - Get user's chats
- `POST /api/chats` - Create new chat
- `GET /api/chats/:id/messages` - Get messages

### Users
- `GET /api/users/search?q=query` - Search users

## Socket Events

### Client -> Server
- `join_chat` - Join a chat room
- `leave_chat` - Leave a chat room
- `send_message` - Send a message
- `typing` - User is typing
- `stop_typing` - User stopped typing

### Server -> Client
- `new_message` - New message received
- `user_online` - User online status changed
- `user_typing` - User is typing
- `user_stop_typing` - User stopped typing

## License

MIT
