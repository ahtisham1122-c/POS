"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";

interface Device {
  id: string;
  deviceId: string;
  deviceName: string;
  terminalNumber: number;
  lastSeenAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  pendingCount?: number; // Fetched from dynamic status
}

export default function AdminSyncDashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDevices = async () => {
    try {
      const res = await axios.get("/api/sync/devices");
      const fetchedDevices = res.data.data;

      // Enhance with realtime status
      const enhanced = await Promise.all(
        fetchedDevices.map(async (d: Device) => {
          try {
            const statusRes = await axios.get(`/api/sync/status?deviceId=${d.deviceId}`);
            return { ...d, pendingCount: statusRes.data.pendingInCloud };
          } catch {
            return { ...d, pendingCount: 0 };
          }
        })
      );

      setDevices(enhanced);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
    const int = setInterval(fetchDevices, 30000);
    return () => clearInterval(int);
  }, []);

  const handleForcePull = async (deviceId: string) => {
    alert(`A websocket or FCM push message would be sent to terminal ${deviceId} here instructing it to immediately clear local memory and pull a fresh DB copy.`);
  };

  if (loading) return <div className="p-8">Loading offline fleet status...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold font-poppins text-gray-900">Terminals (Offline Sync Fleet)</h1>
      <p className="text-gray-500">
        Monitor your active point of sale machines. Terminals synchronize silently in the background 
        and can function completely without internet.
      </p>

      <div className="bg-white border rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Terminal</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pending Cloud Items</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Sync</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {devices.map((device) => {
              const lastSeenDate = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
              const isOnline = lastSeenDate && (new Date().getTime() - lastSeenDate.getTime() < 120000); // Online if seen in last 2 mins

              return (
                <tr key={device.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="font-medium text-gray-900">{device.deviceName} (T{device.terminalNumber})</div>
                    <div className="text-sm text-gray-500 font-mono">{device.deviceId}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isOnline ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {isOnline ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {device.pendingCount} records out of sync
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {device.lastSyncedAt ? formatDistanceToNow(new Date(device.lastSyncedAt), { addSuffix: true }) : 'Never'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      onClick={() => handleForcePull(device.deviceId)}
                      className="text-indigo-600 hover:text-indigo-900 bg-indigo-50 px-3 py-1 rounded"
                    >
                      Force Re-Pull
                    </button>
                  </td>
                </tr>
              );
            })}
            {devices.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  No terminals registered yet. Log into the Electron app to enroll Terminal 1.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
