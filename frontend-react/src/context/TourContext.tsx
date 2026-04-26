import React, { createContext, useContext } from 'react';

interface TourContextValue {
  startTour: () => void;
}

const TourContext = createContext<TourContextValue>({ startTour: () => {} });

export const useTour = (): TourContextValue => useContext(TourContext);

export const TourProvider: React.FC<{ startTour: () => void; children: React.ReactNode }> = ({ startTour, children }) => (
  <TourContext.Provider value={{ startTour }}>{children}</TourContext.Provider>
);
