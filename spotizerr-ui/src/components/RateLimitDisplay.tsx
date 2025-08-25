import React, { useState, useEffect, useRef } from 'react';
import authApiClient from '../lib/api-client';
import { FaTrafficLight, FaTimes } from 'react-icons/fa';

interface RateLimitData {
  current_requests_per_second: number;
  max_requests_per_second: number;
  current_requests_per_window: number;
  max_requests_per_window: number;
  window_size_seconds: number;
}

const RateLimitDisplay: React.FC = () => {
  const [rateLimit, setRateLimit] = useState<RateLimitData | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchRateLimit = async () => {
    try {
      const response = await authApiClient.get('/rate-limit/current');
      if (response.status !== 200) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: RateLimitData = response.data;
      setRateLimit(data);
      setError(null);
    } catch (e: any) {
      console.error("Failed to fetch rate limit:", e);
      setError(`Failed to load rate limit: ${e.message}`);
      setRateLimit(null);
    }
  };

  useEffect(() => {
    fetchRateLimit();
    const interval = setInterval(fetchRateLimit, 1000); // Refresh every second
    return () => clearInterval(interval);
  }, []);


  const getIndicatorColor = (current: number, max: number): string => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return 'text-red-500';
    if (percentage >= 70) return 'text-orange-500';
    if (percentage >= 50) return 'text-yellow-500';
    return 'text-gray-800'; // Changed from text-green-500 to text-gray-800
  };

  const getUsageColor = (current: number, max: number): string => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-orange-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (error) {
    return (
      <div className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark cursor-pointer"
           onClick={() => setShowDetails(!showDetails)}
           title={`Error: ${error}`}>
        <FaTrafficLight className="h-6 w-6 text-red-500" />
      </div>
    );
  }

  if (!rateLimit) {
    return (
      <div className="p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark">
        <FaTrafficLight className="h-6 w-6 text-gray-500" />
      </div>
    );
  }

  const windowUsage = rateLimit.current_requests_per_window;
  const windowMax = rateLimit.max_requests_per_window;
  const windowSize = rateLimit.window_size_seconds;
  const windowColor = getIndicatorColor(windowUsage, windowMax);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        className={`p-2 rounded-full hover:bg-icon-button-hover dark:hover:bg-icon-button-hover-dark ${windowColor}`}
        onClick={() => setShowDetails(!showDetails)}
        title={`Rate Limit: ${windowUsage}/${windowMax} requests per ${windowSize}s`}
      >
        <FaTrafficLight className="h-6 w-6" />
      </button>

      {showDetails && (
        <div
          ref={popupRef}
          className="absolute top-full right-0 mt-2 w-80 bg-surface dark:bg-surface-dark rounded-xl shadow-2xl border border-border dark:border-border-dark z-50"
        >
          <div className="p-0">
            <div className="flex items-center justify-between p-4 border-b border-border dark:border-border-dark bg-gradient-to-r from-surface to-surface-secondary dark:from-surface-dark dark:to-surface-secondary-dark rounded-t-xl">
              <h3 className="text-lg font-bold text-content-primary dark:text-content-primary-dark">Rate Limit Consumption</h3>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDetails(false);
                }}
                className="text-content-muted dark:text-content-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark p-2 rounded-md hover:bg-surface-muted dark:hover:bg-surface-muted-dark transition-colors min-h-[44px] flex items-center justify-center"
                aria-label="Close"
              >
                <FaTimes className="text-base" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-content-secondary dark:text-content-muted-dark">30 Second Window Usage</span>
                  <span className="font-medium text-content-primary dark:text-content-primary-dark">{windowUsage} / {windowMax}</span>
                </div>
                <div className="w-full bg-surface-muted dark:bg-surface-muted-dark rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${getUsageColor(windowUsage, windowMax)}`}
                    style={{ width: `${Math.min((windowUsage / windowMax) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-content-secondary dark:text-content-muted-dark">Per-Second Usage</span>
                  <span className="font-medium text-content-primary dark:text-content-primary-dark">{rateLimit.current_requests_per_second} / {rateLimit.max_requests_per_second}</span>
                </div>
                <div className="w-full bg-surface-muted dark:bg-surface-muted-dark rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${getUsageColor(rateLimit.current_requests_per_second, rateLimit.max_requests_per_second)}`}
                    style={{ width: `${Math.min((rateLimit.current_requests_per_second / rateLimit.max_requests_per_second) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
            <p className="text-xs p-4 pt-3 border-t border-border dark:border-border-dark text-content-muted dark:text-content-muted-dark">
              External API requests are limited to prevent rate limit errors.
              If limits are exceeded, requests may be delayed or rejected.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default RateLimitDisplay;