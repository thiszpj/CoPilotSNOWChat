import React, { useState } from 'react';
import CopilotDirectLineChat from './components/CopilotDirectLineChat';
import ServiceNowTester from './components/ServiceNowTester';
import UnifiedChatWithHandoff from './components/UnifiedChatWithHandoff';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('unified');

  return (
    <div className="App">
      <header className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold">Integration Testing Portal</h1>
          <div className="flex gap-4 mt-2">
            <button
              onClick={() => setActiveTab('unified')}
              className={`px-4 py-2 rounded ${activeTab === 'unified' ? 'bg-white text-blue-600' : 'bg-blue-500'}`}
            >
              🤝 Unified Chat
            </button>
            <button
              onClick={() => setActiveTab('copilot')}
              className={`px-4 py-2 rounded ${activeTab === 'copilot' ? 'bg-white text-blue-600' : 'bg-blue-500'}`}
            >
              🤖 Copilot Chat
            </button>
            <button
              onClick={() => setActiveTab('servicenow')}
              className={`px-4 py-2 rounded ${activeTab === 'servicenow' ? 'bg-white text-blue-600' : 'bg-blue-500'}`}
            >
              🎫 ServiceNow Tester
            </button>
          </div>
        </div>
      </header>
      <main className="min-h-screen bg-gray-100 py-8">
        {activeTab === 'unified' && <UnifiedChatWithHandoff />}
        {activeTab === 'copilot' && <CopilotDirectLineChat />}
        {activeTab === 'servicenow' && <ServiceNowTester />}
      </main>
    </div>
  );
}

export default App;