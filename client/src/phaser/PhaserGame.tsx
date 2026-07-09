import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createPhaserConfig } from './config';

export function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    const game = new Phaser.Game(createPhaserConfig(containerRef.current));
    gameRef.current = game;
    // Poignée de debug/E2E (inspection de la scène depuis la console ou CDP).
    (window as unknown as { __webintiGame?: Phaser.Game }).__webintiGame = game;
    return () => {
      game.destroy(true);
      gameRef.current = null;
      delete (window as unknown as { __webintiGame?: Phaser.Game }).__webintiGame;
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
