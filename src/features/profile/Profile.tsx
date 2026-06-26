import React from 'react';
import { useAuthStore } from '../../core/store/authStore';

export default function Profile() {
  const { userProfile } = useAuthStore();

  if (!userProfile) return null;

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center gap-6">
          <div className="h-24 w-24 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-3xl font-bold">
            {userProfile.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{userProfile.name}</h2>
            <p className="text-gray-500">@{userProfile.username}</p>
          </div>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-6 border border-gray-100">
          <h3 className="font-medium text-gray-900 mb-4">Account Details</h3>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between border-b border-gray-200 pb-4">
              <dt className="text-gray-500">Email</dt>
              <dd className="font-medium text-gray-900">{userProfile.email}</dd>
            </div>
            <div className="flex justify-between border-b border-gray-200 pb-4">
              <dt className="text-gray-500">Visibility</dt>
              <dd className="font-medium text-gray-900 capitalize">{userProfile.profileVisibility}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Account Role</dt>
              <dd className="font-medium text-gray-900 capitalize">{userProfile.role}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
