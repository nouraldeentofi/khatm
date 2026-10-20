// Public-site build: ship React inside the page instead of fetching it from a CDN, so the
// site works on networks that block or slow third-party script hosts. Imported first by
// main.tsx; the Artifact build swaps this file for an empty one and loads React from cdnjs.
import * as React from "react";
import * as ReactDOM from "react-dom/client";

Object.assign(globalThis, { React, ReactDOM });
