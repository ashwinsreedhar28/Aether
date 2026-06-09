import { useEffect, useState, useCallback } from 'react';

interface UseKanbanKeyboardProps {
  isActive: boolean;
  columns: Array<{ id: string; cards: Array<{ id: string }> }>;
  onNewCard: (columnId: string) => void;
  onEditCard: (cardId: string, columnId: string) => void;
  onCloseModal: () => void;
  hasOpenModal: boolean;
}

interface CardPosition {
  cardId: string;
  columnId: string;
  columnIndex: number;
  cardIndex: number;
}

export function useKanbanKeyboard({
  isActive,
  columns,
  onNewCard,
  onEditCard,
  onCloseModal,
  hasOpenModal,
}: UseKanbanKeyboardProps) {
  const [selectedCard, setSelectedCard] = useState<CardPosition | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Find card position
  const findCardPosition = useCallback((cardId: string): CardPosition | null => {
    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      const column = columns[colIdx];
      const cardIdx = column.cards.findIndex(c => c.id === cardId);
      if (cardIdx !== -1) {
        return {
          cardId,
          columnId: column.id,
          columnIndex: colIdx,
          cardIndex: cardIdx,
        };
      }
    }
    return null;
  }, [columns]);

  // Navigate to adjacent card
  const navigateCard = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (!selectedCard) {
      // Select first card in first column
      const firstCol = columns[0];
      if (firstCol?.cards.length > 0) {
        setSelectedCard({
          cardId: firstCol.cards[0].id,
          columnId: firstCol.id,
          columnIndex: 0,
          cardIndex: 0,
        });
      }
      return;
    }

    const { columnIndex, cardIndex } = selectedCard;
    let newColIdx = columnIndex;
    let newCardIdx = cardIndex;

    switch (direction) {
      case 'up':
        newCardIdx = Math.max(0, cardIndex - 1);
        break;
      case 'down':
        newCardIdx = Math.min(columns[columnIndex].cards.length - 1, cardIndex + 1);
        break;
      case 'left':
        newColIdx = Math.max(0, columnIndex - 1);
        // Try to maintain similar position in new column
        newCardIdx = Math.min(cardIndex, columns[newColIdx].cards.length - 1);
        if (columns[newColIdx].cards.length === 0) newCardIdx = -1;
        break;
      case 'right':
        newColIdx = Math.min(columns.length - 1, columnIndex + 1);
        newCardIdx = Math.min(cardIndex, columns[newColIdx].cards.length - 1);
        if (columns[newColIdx].cards.length === 0) newCardIdx = -1;
        break;
    }

    if (newCardIdx >= 0 && columns[newColIdx]?.cards[newCardIdx]) {
      const newCard = columns[newColIdx].cards[newCardIdx];
      setSelectedCard({
        cardId: newCard.id,
        columnId: columns[newColIdx].id,
        columnIndex: newColIdx,
        cardIndex: newCardIdx,
      });
    }
  }, [selectedCard, columns]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in input/textarea
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (target.closest('[contenteditable="true"]')) return;
      if (target.closest('.ProseMirror')) return;

      // Handle modal close
      if (e.key === 'Escape') {
        if (hasOpenModal) {
          onCloseModal();
        } else {
          setSelectedCard(null);
        }
        return;
      }

      // Don't process other shortcuts if modal is open
      if (hasOpenModal) return;

      // Don't intercept Cmd/Ctrl+Arrow for window navigation
      if ((e.metaKey || e.ctrlKey) &&
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return;
      }

      switch (e.key) {
        case 'n': {
          e.preventDefault();
          // New card in selected column or first column
          const targetColumnId = selectedCard?.columnId || columns[0]?.id;
          if (targetColumnId) {
            onNewCard(targetColumnId);
          }
          break;
        }

        case 'e':
          e.preventDefault();
          if (selectedCard) {
            onEditCard(selectedCard.cardId, selectedCard.columnId);
          }
          break;

        case '?':
          e.preventDefault();
          setShowHelp(prev => !prev);
          break;

        case 'ArrowUp':
          e.preventDefault();
          navigateCard('up');
          break;

        case 'ArrowDown':
          e.preventDefault();
          navigateCard('down');
          break;

        case 'ArrowLeft':
          e.preventDefault();
          navigateCard('left');
          break;

        case 'ArrowRight':
          e.preventDefault();
          navigateCard('right');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, hasOpenModal, selectedCard, columns, onNewCard, onEditCard, onCloseModal, navigateCard]);

  // Clear selection when the selected card no longer exists in the columns.
  // Computed during render (React's recommended pattern for adjusting state
  // in response to prop changes) to avoid a cascading effect render.
  if (selectedCard && !findCardPosition(selectedCard.cardId)) {
    setSelectedCard(null);
  }

  return {
    selectedCard,
    setSelectedCard,
    showHelp,
    setShowHelp,
  };
}
