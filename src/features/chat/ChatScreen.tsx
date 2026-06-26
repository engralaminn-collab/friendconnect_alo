import React, { useState } from 'react';
import { Send, Image, FileText, Video, Phone, Video as VideoIcon } from 'lucide-react';
import { Input } from '../../components/ui/Input';

export default function ChatScreen() {
  const [message, setMessage] = useState('');

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    // Send message logic here
    setMessage('');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
            F
          </div>
          <div>
            <h3 className="font-medium text-gray-900">Friend Name</h3>
            <p className="text-xs text-green-600 font-medium">Online</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-gray-500">
          <button className="hover:text-blue-600 transition-colors"><Phone className="h-5 w-5" /></button>
          <button className="hover:text-blue-600 transition-colors"><VideoIcon className="h-5 w-5" /></button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Placeholder messages */}
        <div className="flex justify-start">
          <div className="bg-white border border-gray-200 text-gray-900 px-4 py-2 rounded-2xl rounded-tl-none max-w-md shadow-sm">
            <p>Hey! How are you doing?</p>
            <p className="text-[10px] text-gray-400 mt-1 text-right">10:00 AM</p>
          </div>
        </div>
        <div className="flex justify-end">
          <div className="bg-blue-600 text-white px-4 py-2 rounded-2xl rounded-tr-none max-w-md shadow-sm">
            <p>I'm doing great, working on the new app!</p>
            <p className="text-[10px] text-blue-200 mt-1 text-right">10:02 AM</p>
          </div>
        </div>
      </div>

      {/* Input */}
      <footer className="p-4 bg-white border-t border-gray-200">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-gray-400 px-2">
            <button type="button" className="hover:text-gray-600 transition-colors"><Image className="h-5 w-5" /></button>
            <button type="button" className="hover:text-gray-600 transition-colors"><Video className="h-5 w-5" /></button>
            <button type="button" className="hover:text-gray-600 transition-colors"><FileText className="h-5 w-5" /></button>
          </div>
          <Input 
            className="flex-1 rounded-full bg-gray-100 border-transparent focus:bg-white"
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button 
            type="submit"
            className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Send className="h-4 w-4 ml-1" />
          </button>
        </form>
      </footer>
    </div>
  );
}
