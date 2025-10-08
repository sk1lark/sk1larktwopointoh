# Voxel Cafe Implementation Notes

## Current Status
- ✅ Voxel shelves with books, cups, and plants
- 🔄 Converting counter, tables, floor to voxel style
- The voxel size is 0.04 units

## Performance Optimization
Using individual BoxGeometry for each voxel creates too many objects.
Need to use InstancedMesh or merge geometries for better performance.

## Voxel Colors
- Wood: 0x6b4423, 0x5a3a1f (alternating)
- Books: 0x8b6f47, 0xa67c52, 0xd2685c, 0x5d8ba6
- Cups: 0xe8d5c4, 0xa67c52, 0xd2685c
- Plants: Pot 0x8b4513, Leaves 0x4a7c59
- Floor: 0x5c4033, 0x634835 (alternating planks)
