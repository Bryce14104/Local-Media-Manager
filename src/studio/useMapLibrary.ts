import { useEffect, useState } from "react";
import { getMapLibrary, loadMapLibrary, subscribeMapLibrary, type MapLibrarySnapshot } from "./mapLibrary";

export function useMapLibrary(): MapLibrarySnapshot {
  const [library, setLibrary] = useState(getMapLibrary);
  useEffect(() => {
    void loadMapLibrary();
    return subscribeMapLibrary(setLibrary);
  }, []);
  return library;
}
