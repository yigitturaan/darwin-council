
// OKX tarzı blok karakterler (9x9). # siyah blok, r kırmızı blok, g gri blok, . boşluk (göz ve aralıklar zeminden görünür)
const shapes = {
  momentum: [ // yukarı ok / roket
    "....#....",
    "...###...",
    "..#####..",
    ".##.#.##.",
    ".#######.",
    "..##r##..",
    "..#####..",
    "..#...#..",
    ".##...##."],
  likidite: [ // damla
    "....#....",
    "...###...",
    "..#####..",
    ".##.#.##.",
    ".#######.",
    ".#######.",
    ".###r###.",
    "..#####..",
    "...#.#..."],
  turev: [ // ikiz bloklar (ayna)
    ".###.###.",
    ".#.#.#.#.",
    ".###.###.",
    "....#....",
    "..#####..",
    "..##r##..",
    "..#####..",
    "..#...#..",
    ".##...##."],
  vol: [ // şimşek / zikzak
    "...####..",
    "..####...",
    ".##.#.#..",
    ".######..",
    "..######.",
    "...##r#..",
    "..####...",
    "..#..#...",
    ".##..##.."],
  baskan: [ // taçlı blok, kırmızı kravat
    "r.r.r.r.r",
    "#########",
    ".#######.",
    ".##.#.##.",
    ".#######.",
    "...#r#...",
    ".###r###.",
    ".#######.",
    ".##...##."],
  cirak: [ // küçük filiz, gri (deneme)
    "...r.r...",
    "....g....",
    ".........",
    "...ggg...",
    "..gg.gg..",
    "..g.g.g..",
    "..ggggg..",
    "...g.g...",
    "..gg.gg.."],
};
const color = {"#":"#0B0B0D", r:"#E84142", g:"#9B9DA5"};
function draw(svg){
  const s = shapes[svg.dataset.c]; if(!s) return;
  svg.setAttribute("viewBox","0 0 9 9"); svg.setAttribute("shape-rendering","crispEdges");
  let out="";
  s.forEach((row,y)=>[...row].forEach((ch,x)=>{ if(color[ch]) out+=`<rect x="${x+.07}" y="${y+.07}" width=".86" height=".86" fill="${color[ch]}"/>`; }));
  svg.innerHTML=out;
}
window.drawDarwinSprite = draw;
document.querySelectorAll("svg[data-c]").forEach(draw);

// Konseyin etrafında toplandığı kırmızı, üçgen biçimli blok masa.
(function(){
  const svg = document.getElementById('tri');
  if (!svg) return;
  let out = '';
  for (let y=0; y<9; y++) {
    for (let x=8-y; x<=8+y; x++)
      out += `<rect x="${x+.06}" y="${y+.06}" width=".88" height=".88" fill="#E84142"/>`;
  }
  out += '<rect x="1.06" y="9.04" width="14.88" height=".48" fill="#B8292A"/>';
  out += '<rect x="2.1" y="9.52" width="1.1" height="1.1" fill="#0B0B0D"/>';
  out += '<rect x="13.8" y="9.52" width="1.1" height="1.1" fill="#0B0B0D"/>';
  svg.innerHTML = out;
})();


