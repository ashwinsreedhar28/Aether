import { useState, useCallback, useEffect } from 'react';
import { Delete } from 'lucide-react';
import type { AppProps } from '../types';

type Operation = '+' | '-' | '×' | '÷' | null;

function Button({
  children,
  onClick,
  className = '',
  span = 1,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  span?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center justify-center text-xl font-medium
        rounded-lg transition-all duration-150
        hover:brightness-110 active:scale-95
        ${span === 2 ? 'col-span-2' : ''}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

export function Calculator({ isActive }: AppProps) {
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  const inputDigit = useCallback((digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  }, [display, waitingForOperand]);

  const inputDecimal = useCallback(() => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
    } else if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  }, [display, waitingForOperand]);

  const clear = useCallback(() => {
    setDisplay('0');
    setPreviousValue(null);
    setOperation(null);
    setWaitingForOperand(false);
  }, []);

  const backspace = useCallback(() => {
    if (display.length > 1) {
      setDisplay(display.slice(0, -1));
    } else {
      setDisplay('0');
    }
  }, [display]);

  const toggleSign = useCallback(() => {
    const value = parseFloat(display);
    setDisplay(String(-value));
  }, [display]);

  const inputPercent = useCallback(() => {
    const value = parseFloat(display);
    setDisplay(String(value / 100));
  }, [display]);

  const performOperation = useCallback((nextOperation: Operation) => {
    const inputValue = parseFloat(display);

    if (previousValue === null) {
      setPreviousValue(inputValue);
    } else if (operation) {
      const currentValue = previousValue;
      let result = currentValue;

      switch (operation) {
        case '+':
          result = currentValue + inputValue;
          break;
        case '-':
          result = currentValue - inputValue;
          break;
        case '×':
          result = currentValue * inputValue;
          break;
        case '÷':
          result = inputValue !== 0 ? currentValue / inputValue : 0;
          break;
      }

      setDisplay(String(result));
      setPreviousValue(result);
    }

    setWaitingForOperand(true);
    setOperation(nextOperation);
  }, [display, operation, previousValue]);

  const calculate = useCallback(() => {
    if (operation && previousValue !== null) {
      const inputValue = parseFloat(display);
      let result = previousValue;

      switch (operation) {
        case '+':
          result = previousValue + inputValue;
          break;
        case '-':
          result = previousValue - inputValue;
          break;
        case '×':
          result = previousValue * inputValue;
          break;
        case '÷':
          result = inputValue !== 0 ? previousValue / inputValue : 0;
          break;
      }

      setDisplay(String(result));
      setPreviousValue(null);
      setOperation(null);
      setWaitingForOperand(true);
    }
  }, [display, operation, previousValue]);

  // Keyboard support
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        inputDigit(e.key);
      } else if (e.key === '.') {
        inputDecimal();
      } else if (e.key === '+') {
        performOperation('+');
      } else if (e.key === '-') {
        performOperation('-');
      } else if (e.key === '*') {
        performOperation('×');
      } else if (e.key === '/') {
        e.preventDefault();
        performOperation('÷');
      } else if (e.key === 'Enter' || e.key === '=') {
        calculate();
      } else if (e.key === 'Escape' || e.key === 'Clear') {
        clear();
      } else if (e.key === 'Backspace') {
        backspace();
      } else if (e.key === '%') {
        inputPercent();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, inputDigit, inputDecimal, performOperation, calculate, clear, backspace, inputPercent]);

  return (
    <div className="h-full flex flex-col p-4 bg-[rgba(10,10,20,0.9)]">
      {/* Display */}
      <div className="mb-4 p-4 bg-[rgba(0,0,0,0.4)] rounded-lg border border-[var(--holo-border)]">
        <div className="text-right text-xs text-[var(--holo-muted)] h-5">
          {previousValue !== null && operation && `${previousValue} ${operation}`}
        </div>
        <div className="text-right text-4xl font-mono text-[var(--holo-text)] truncate">
          {display}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex-1 grid grid-cols-4 gap-2">
        {/* Row 1 */}
        <Button onClick={clear} className="bg-[var(--holo-border)] text-[var(--holo-text)]">
          AC
        </Button>
        <Button onClick={toggleSign} className="bg-[var(--holo-border)] text-[var(--holo-text)]">
          ±
        </Button>
        <Button onClick={inputPercent} className="bg-[var(--holo-border)] text-[var(--holo-text)]">
          %
        </Button>
        <Button onClick={() => performOperation('÷')} className={`bg-[var(--holo-accent)] text-black ${operation === '÷' ? 'ring-2 ring-white' : ''}`}>
          ÷
        </Button>

        {/* Row 2 */}
        <Button onClick={() => inputDigit('7')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          7
        </Button>
        <Button onClick={() => inputDigit('8')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          8
        </Button>
        <Button onClick={() => inputDigit('9')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          9
        </Button>
        <Button onClick={() => performOperation('×')} className={`bg-[var(--holo-accent)] text-black ${operation === '×' ? 'ring-2 ring-white' : ''}`}>
          ×
        </Button>

        {/* Row 3 */}
        <Button onClick={() => inputDigit('4')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          4
        </Button>
        <Button onClick={() => inputDigit('5')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          5
        </Button>
        <Button onClick={() => inputDigit('6')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          6
        </Button>
        <Button onClick={() => performOperation('-')} className={`bg-[var(--holo-accent)] text-black ${operation === '-' ? 'ring-2 ring-white' : ''}`}>
          −
        </Button>

        {/* Row 4 */}
        <Button onClick={() => inputDigit('1')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          1
        </Button>
        <Button onClick={() => inputDigit('2')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          2
        </Button>
        <Button onClick={() => inputDigit('3')} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          3
        </Button>
        <Button onClick={() => performOperation('+')} className={`bg-[var(--holo-accent)] text-black ${operation === '+' ? 'ring-2 ring-white' : ''}`}>
          +
        </Button>

        {/* Row 5 */}
        <Button onClick={() => inputDigit('0')} span={2} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          0
        </Button>
        <Button onClick={inputDecimal} className="bg-[rgba(60,60,80,0.8)] text-[var(--holo-text)]">
          .
        </Button>
        <Button onClick={calculate} className="bg-[var(--holo-accent)] text-black">
          =
        </Button>
      </div>

      {/* Backspace */}
      <button
        onClick={backspace}
        className="mt-2 p-2 flex items-center justify-center gap-2 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
      >
        <Delete className="w-4 h-4" />
        Backspace
      </button>
    </div>
  );
}
