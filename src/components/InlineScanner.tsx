import React from 'react';
import ScannerPanel, { ScannerPanelProps } from './ScannerPanel';

interface InlineScannerProps extends Omit<ScannerPanelProps, 'showClose' | 'onClose'> {
  className?: string;
}

const InlineScanner: React.FC<InlineScannerProps> = ({ className, ...props }) => {
  return (
    <ScannerPanel
      {...props}
      className={`w-full bg-ninpo-card border border-white/5 ${className || ''}`.trim()}
    />
  );
};

export default InlineScanner;
