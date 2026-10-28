# Pharma POS

Pharmacy point of sale for ERPNext, built with React, TypeScript, and Vite.

## Features

- 🏪 **Pharmacy POS** - Dispensing, checkout, and in-store sales
- 📱 **Mobile-First Design** - Responsive UI that works on all devices
- 👥 **Customer Management** - Add, edit, and manage customer information
- 🛒 **Cart Management** - Intuitive cart with item management
- 💳 **Payment Processing** - Multiple payment methods support
- 📊 **Real-time Dashboard** - Sales analytics and reporting
- 🌐 **Multi-language Support** - Built-in internationalization
- 🌙 **Dark Mode** - Light and dark theme support
- 💾 **Offline Capable** - Works offline with data synchronization

## Tech Stack

- **Frontend**: React 19 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Routing**: React Router
- **Icons**: Lucide React
- **Backend Integration**: ERPNext API compatible

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-org/klik_spa.git
cd klik_spa
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Start the development server:
```bash
npm run dev
# or
yarn dev
```

4. Open [http://localhost:5173](http://localhost:5173) in your browser.

## Available Scripts

- `yarn dev` - Start development server
- `yarn build` - Build for production
- `yarn serve` - Preview production build
- `yarn lint` - Run ESLint

## Project Structure

```
src/
├── components/     # Reusable UI components
├── pages/         # Page components
├── hooks/         # Custom React hooks
├── stores/        # State management (Zustand)
├── services/      # API services
├── providers/     # Context providers
└── types/         # TypeScript type definitions
```

## Configuration

The application can be configured for different environments:

1. **Development**: Uses mock data and development APIs
2. **Production**: Connects to ERPNext backend
3. **Offline Mode**: Local storage fallback

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary software. All rights reserved.

## Support

For support and questions, please contact the development team (info@beverensoftware.com).
