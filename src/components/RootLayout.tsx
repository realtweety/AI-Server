import { Outlet } from 'react-router-dom'; // fixed import from react-router-dom

export function RootLayout() {
  return (
    <div className="min-h-screen w-full relative overflow-hidden">
      {/* Animated gradient background */}
      <div className="fixed inset-0 gradient-bg z-0" />

      {/* Floating glass orbs */}
      <div className="glass-orb float-slow  w-96 h-96 fixed top-[-10%]  left-[-5%]   opacity-50 z-0" />
      <div className="glass-orb float-medium w-64 h-64 fixed top-[20%]   right-[5%]  opacity-40 z-0" />
      <div className="glass-orb float-fast  w-80 h-80 fixed bottom-[-10%] right-[-10%] opacity-60 z-0" />
      <div className="glass-orb float-slow  w-48 h-48 fixed bottom-[30%] left-[10%]  opacity-30 z-0" />

      {/* Page content */}
      <div className="relative z-10 min-h-screen">
        <Outlet />
      </div>
    </div>
  );
}