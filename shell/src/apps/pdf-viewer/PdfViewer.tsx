import { useState, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import { useAppContext } from '../AppContext';
import type { AppProps } from '../types';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export function PdfViewer({ filePath }: AppProps) {
  const { fileApi } = useAppContext();

  const [pdfData, setPdfData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const loadPdf = useCallback(async () => {
    if (!filePath) return;

    setLoading(true);
    setError(null);

    try {
      const data = await fileApi.readFile(filePath);
      setPdfData(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PDF');
    } finally {
      setLoading(false);
    }
  }, [filePath, fileApi]);

  useEffect(() => {
    loadPdf();
  }, [loadPdf]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(1);
  };

  const goToPrevPage = useCallback(() => setCurrentPage((p) => Math.max(1, p - 1)), []);
  const goToNextPage = useCallback(
    () => setCurrentPage((p) => Math.min(numPages, p + 1)),
    [numPages]
  );
  const handleZoomIn = () => setScale((s) => Math.min(3, s + 0.25));
  const handleZoomOut = () => setScale((s) => Math.max(0.25, s - 0.25));
  const handlePageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const page = parseInt(e.target.value, 10);
    if (page >= 1 && page <= numPages) {
      setCurrentPage(page);
    }
  };

  const toggleSearch = useCallback(() => {
    setShowSearch(!showSearch);
    if (showSearch) {
      setSearchText('');
    }
  }, [showSearch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        toggleSearch();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        goToPrevPage();
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        goToNextPage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevPage, goToNextPage, toggleSearch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--holo-muted)]">
        Loading PDF...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        {error}
      </div>
    );
  }

  if (!pdfData) {
    return null;
  }

  const fileName = filePath?.split('/').pop() || 'PDF';

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
        <span className="text-xs text-[var(--holo-muted)] truncate max-w-[200px]">
          {fileName}
        </span>

        <div className="flex items-center gap-2">
          {/* Search */}
          {showSearch && (
            <div className="flex items-center gap-1 mr-2">
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search..."
                className="px-2 py-0.5 text-xs bg-[rgba(0,0,0,0.3)] border border-[var(--holo-border)] rounded text-[var(--holo-text)] w-32"
                autoFocus
              />
              <button
                onClick={toggleSearch}
                className="p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <button
            onClick={toggleSearch}
            className="p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
            title="Search (Cmd+F)"
          >
            <Search className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-[var(--holo-border)]" />

          {/* Zoom controls */}
          <button
            onClick={handleZoomOut}
            className="p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-[var(--holo-muted)] w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-[var(--holo-border)]" />

          {/* Page navigation */}
          <button
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            className="p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors disabled:opacity-30"
            title="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1 text-xs text-[var(--holo-muted)]">
            <input
              type="number"
              value={currentPage}
              onChange={handlePageInput}
              min={1}
              max={numPages}
              className="w-10 px-1 py-0.5 text-center bg-[rgba(0,0,0,0.3)] border border-[var(--holo-border)] rounded text-[var(--holo-text)]"
            />
            <span>/ {numPages}</span>
          </div>
          <button
            onClick={goToNextPage}
            disabled={currentPage >= numPages}
            className="p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors disabled:opacity-30"
            title="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* PDF container */}
      <div className="flex-1 overflow-auto flex justify-center p-4 bg-[rgba(0,0,0,0.3)]">
        <Document
          file={pdfData}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="text-[var(--holo-muted)]">Loading document...</div>
          }
          error={
            <div className="text-red-400">Failed to load PDF document</div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            className="shadow-lg"
            customTextRenderer={
              searchText
                ? ({ str }) => {
                    if (!searchText) return str;
                    const regex = new RegExp(`(${searchText})`, 'gi');
                    const parts = str.split(regex);
                    return parts
                      .map((part) =>
                        regex.test(part)
                          ? `<mark style="background-color: yellow; color: black;">${part}</mark>`
                          : part
                      )
                      .join('');
                  }
                : undefined
            }
          />
        </Document>
      </div>
    </div>
  );
}
