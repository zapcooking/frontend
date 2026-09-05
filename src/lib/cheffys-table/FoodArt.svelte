<script lang="ts">
  import { pantry } from './service';
  export let id: string;
  // The hand-painted atlas has organic spacing. Explicit crops avoid neighboring food bleeding in.
  const crops = [
    [16, 55, 244, 279],
    [257, 50, 264, 282],
    [522, 32, 230, 315],
    [765, 67, 239, 280],
    [1009, 52, 244, 288],
    [25, 347, 245, 283],
    [262, 335, 249, 289],
    [523, 330, 239, 298],
    [749, 361, 258, 253],
    [997, 348, 256, 273],
    [14, 633, 253, 260],
    [267, 623, 245, 281],
    [515, 642, 247, 275],
    [770, 640, 231, 265],
    [1004, 623, 249, 270],
    [20, 887, 246, 349],
    [266, 944, 247, 281],
    [522, 913, 230, 306],
    [756, 913, 261, 306],
    [1027, 889, 219, 346]
  ];
  $: [x, y, w, h] =
    crops[
      Math.max(
        0,
        pantry.findIndex((f) => f.id === id)
      )
    ];
  $: largest = Math.max(w, h);
</script>

<span class="food-art" aria-hidden="true"
  ><span
    style={`width:${(w / largest) * 100}%;height:${(h / largest) * 100}%;background-size:${(1254 / w) * 100}% ${(1254 / h) * 100}%;background-position:${(x / (1254 - w)) * 100}% ${(y / (1254 - h)) * 100}%`}
  ></span></span
>

<style>
  .food-art {
    display: block;
    width: var(--food-size, 72px);
    aspect-ratio: 1;
    flex: 0 0 auto;
    position: relative;
  }
  .food-art > span {
    display: block;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-image: url('/game/pantry-atlas.png');
    background-repeat: no-repeat;
  }
</style>
