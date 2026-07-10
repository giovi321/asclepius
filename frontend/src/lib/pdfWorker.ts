/**
 * pdf.js worker initialisation, imported for its side effect by the two PDF
 * viewers only. Moved out of main.tsx so pdfjs-dist rides the lazy viewer
 * chunks instead of shipping in the entry bundle on every page load.
 * pdfjs-dist is react-pdf's peer dependency — versions always match.
 */
import { pdfjs } from "react-pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
