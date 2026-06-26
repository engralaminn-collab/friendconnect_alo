import React, { useState } from 'react';
import { PhoneOff, MicOff, VideoOff, Mic, Video } from 'lucide-react';

export default function CallScreen({ isVideo = false }: { isVideo?: boolean }) {
  const [muted, setMuted] = useState(false);
  const [videoDisabled, setVideoDisabled] = useState(false);

  return (
    <div className="absolute inset-0 bg-gray-900 z-50 flex flex-col items-center justify-center text-white">
      {isVideo && !videoDisabled ? (
        <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
          <p className="text-gray-400">Video Stream Placeholder</p>
        </div>
      ) : (
        <div className="flex flex-col items-center space-y-4 z-10">
          <div className="h-32 w-32 rounded-full bg-blue-600 flex items-center justify-center text-4xl font-bold shadow-2xl">
            U
          </div>
          <div className="text-center">
            <h2 className="text-3xl font-medium">Username</h2>
            <p className="text-gray-400 mt-2">00:05</p>
          </div>
        </div>
      )}

      <div className="absolute bottom-12 flex items-center gap-6 z-10">
        <button 
          onClick={() => setMuted(!muted)}
          className={`p-4 rounded-full transition-colors ${muted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
        >
          {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>
        
        {isVideo && (
          <button 
            onClick={() => setVideoDisabled(!videoDisabled)}
            className={`p-4 rounded-full transition-colors ${videoDisabled ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
          >
            {videoDisabled ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
          </button>
        )}

        <button className="p-4 rounded-full bg-red-600 hover:bg-red-700 transition-colors">
          <PhoneOff className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
