import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function ChatList() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col h-full">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">Chats</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Mock Chat Item */}
          <div 
            onClick={() => navigate('/chat/1')}
            className="flex items-center gap-3 p-4 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-50"
          >
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold flex-shrink-0">
              F
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline mb-1">
                <h3 className="text-sm font-medium text-gray-900 truncate">Friend Name</h3>
                <span className="text-xs text-gray-500">10:02 AM</span>
              </div>
              <p className="text-sm text-gray-500 truncate">I'm doing great, working on the new app!</p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 bg-gray-50 flex items-center justify-center text-gray-400">
        <p>Select a chat to start messaging</p>
      </div>
    </div>
  );
}
