import type { ComponentProps, ReactNode } from 'react';
import { Button, Card } from 'pixel-retroui';

// В одном месте адаптируем библиотеку к палитре и читаемому русскому тексту.
export function PixelButton({ secondary = false, className = '', ...props }:
  ComponentProps<typeof Button> & { secondary?: boolean }) {
  return <Button type="button" bg={secondary ? '#FFF7ED' : '#365C45'}
    textColor={secondary ? '#35231D' : '#FFFFFF'} borderColor="#35231D"
    shadow={secondary ? '#E8AD55' : '#233F2D'}
    className={`pixel-button ${secondary ? 'secondary' : ''} ${className}`} {...props} />;
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Card bg="#FFFFFF" textColor="#35231D" borderColor="#35231D"
    shadowColor="#E5D8C5" className={`pixel-panel ${className}`}>{children}</Card>;
}
