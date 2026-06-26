import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { User } from '../../core/models/types';

export default function AdminPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      const snap = await getDocs(collection(db, 'users'));
      const u = snap.docs.map(doc => doc.data() as User);
      setUsers(u);
      setLoading(false);
    };
    fetchUsers();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-6">Admin Panel</h2>
      
      {loading ? (
        <p className="text-gray-500">Loading users...</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm text-left">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500">User</th>
                <th className="px-6 py-3 font-medium text-gray-500">Email</th>
                <th className="px-6 py-3 font-medium text-gray-500">Role</th>
                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map(u => (
                <tr key={u.uid} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {u.name} <span className="text-gray-500 font-normal">@{u.username}</span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">{u.email}</td>
                  <td className="px-6 py-4 capitalize text-gray-900">{u.role}</td>
                  <td className="px-6 py-4">
                    {u.isActive ? (
                      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">Active</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">Disabled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
