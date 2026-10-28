import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import POSOpeningEntryGuard from './POSOpeningEntryGuard';

const ProtectedRoute = ({ element }: { element: React.ReactElement }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // Show loading spinner while checking authentication
    return (
      <div className="min-h-screen bg-gradient-to-br from-beveren-50 to-beveren-100 flex items-center justify-center">
        <div className="text-center">
          <img src="/assets/klik_pos/images/beveren-mark.png" alt="" className="w-14 h-14 mx-auto mb-3 object-contain" />
          <div className="text-2xl font-bold text-beveren-700 mb-4">Pharma POS</div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-beveren-700 mx-auto"></div>
          <p className="text-beveren-600 mt-4">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Save the attempted location for redirecting after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Wrap the element with POSOpeningEntryGuard to ensure opening entry exists
  return (
    <POSOpeningEntryGuard excludePaths={['/settings']}>
      {element}
    </POSOpeningEntryGuard>
  );
};

export default ProtectedRoute;
