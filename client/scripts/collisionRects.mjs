/**
 * Fusion gourmande d'une grille de cellules solides en rectangles.
 * Pour chaque cellule solide non encore consommée : on étend au maximum vers
 * la droite (run horizontal), puis on étend ce run vers le bas tant que toutes
 * les cellules de la largeur sont solides et libres. On marque le bloc consommé.
 *
 * @param {boolean[]} grid  tableau plat, length = width*height, indexé y*width+x
 * @param {number} width    nombre de colonnes
 * @param {number} height   nombre de lignes
 * @param {number} tile     taille d'une tuile en pixels
 * @returns {{x:number,y:number,width:number,height:number}[]} rectangles en pixels
 */
export function mergeCollisionRects(grid, width, height, tile) {
  const used = new Array(width * height).fill(false);
  const at = (x, y) => grid[y * width + x] && !used[y * width + x];
  const rects = [];

  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!at(x, y)) {
        x++;
        continue;
      }
      // Étendre vers la droite.
      let x2 = x;
      while (x2 < width && at(x2, y)) x2++;
      // Étendre vers le bas : toutes les colonnes [x, x2) doivent être libres.
      let y2 = y + 1;
      for (; y2 < height; y2++) {
        let full = true;
        for (let xx = x; xx < x2; xx++) {
          if (!at(xx, y2)) {
            full = false;
            break;
          }
        }
        if (!full) break;
      }
      // Marquer le bloc consommé.
      for (let yy = y; yy < y2; yy++) {
        for (let xx = x; xx < x2; xx++) {
          used[yy * width + xx] = true;
        }
      }
      rects.push({
        x: x * tile,
        y: y * tile,
        width: (x2 - x) * tile,
        height: (y2 - y) * tile,
      });
      x = x2;
    }
  }
  return rects;
}
