import React from 'react';

export default function FriendList() {
  return (
    <div className="flex-1 flex flex-col p-8">
      <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-6">Friends</h2>
      <div className="text-gray-500 text-center py-12">
        <p>No friends yet. Search for users to add them!</p>
      </div>
    </div>
  );
}
