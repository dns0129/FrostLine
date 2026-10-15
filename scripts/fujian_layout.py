"""Fujian (CV-18) layout shared by the deck texture and the Blender build.

Plan positions were measured on Gryfia's CC BY-SA 4.0 Commons drawing
"Type 003 Aircraft Carrier Fujian (18).svg" (bow up, port left) after
undoing the drawing's non-uniform group scale, then calibrated to the
published 316 m overall length and 76 m flight-deck width.  Heights come
from the JMSDF broadside photo (CC BY 4.0) using the same length scale.

Pure Python (no bpy) so both system Python and Blender can import it.
Axes: metres, +Z up (waterline 0), bow toward -Y, +X = port.
"""

LOA = 316.0
FLIGHT_DECK = 17.5            # flight deck height above the waterline
DRAFT = 11.0
SX, SY = 0.0749, 0.0795       # drawing px -> m (x across, y along)
CX, BOW_PX = 728, 0           # drawing centreline / bow row


def P(px, py):
    """Drawing pixel (full-res 1283x4000 render) -> (X, Y) metres."""
    return (round((CX - px) * SX, 2), round(-LOA / 2 + (py - BOW_PX) * SY, 2))


def R(px0, py0, px1, py1):
    """Drawing pixel rectangle -> (X0, X1, Y0, Y1) metres, sorted."""
    (a, b), (c, d) = P(px0, py0), P(px1, py1)
    return (min(a, c), max(a, c), min(b, d), max(b, d))


# Flight-deck edge (outer edge of the red deck-edge line), clockwise from the
# port bow corner.
DECK = [P(*p) for p in [
    (548, 8), (518, 700), (510, 935), (205, 1098), (205, 1530), (262, 1700),
    (262, 3580), (330, 3605), (400, 3700), (455, 3780), (455, 3975),
    (1030, 3975), (1030, 3810), (1100, 3700), (1160, 3592), (1226, 3555),
    (1226, 1400), (1167, 1340), (1167, 1060), (1110, 1010), (975, 870),
    (965, 700), (906, 8)]]

# Deck-edge elevators (starboard), X0, X1, Y0, Y1
ELEVATORS = [R(1030, 1555, 1226, 1815), R(1035, 2895, 1226, 3150)]

# Electromagnetic catapults: (front point, launch/aft point)
CATAPULTS = [(P(628, 30), P(628, 1400)), (P(835, 30), P(925, 1420)), (P(330, 1100), P(334, 2480))]
# Jet blast deflectors (X0, X1, Y0, Y1), aft of each launch point
JBDS = [R(690, 1635, 565, 1680), R(995, 1620, 865, 1665), R(400, 2755, 270, 2800)]

# Angled landing area axis (bow end -> stern end) and four arresting wires
LANDING_AXIS = (P(365, 1040), P(795, 3950))
WIRE_STATIONS = [P(640, 2868), P(675, 3020), P(700, 3170), P(722, 3320)]
WIRE_HALF_SPAN = 17.2
# Numbered landing / helicopter spots: (X, Y, radius, number, solid ring?)
SPOTS = [(*P(775, 530), 4.9, '1', False), (*P(415, 1210), 4.9, '2', False),
         (*P(440, 1790), 4.9, '3', False), (*P(440, 2380), 4.9, '4', False),
         (*P(645, 3645), 4.9, '5', True)]
# Weapons-elevator hatches on deck (X0, X1, Y0, Y1)
HATCHES = [R(840, 1285, 810, 1360), R(840, 1395, 810, 1485), R(1128, 3770, 1095, 3800)]

# Island: deck-level podium, main block, forward bridge wing (X0, X1, Y0, Y1)
ISLAND_PODIUM = (-36.6, -21.4, 8.0, 46.0)
ISLAND_BLOCK = (-35.6, -23.0, 16.0, 44.0)
ISLAND_BRIDGE = (-35.0, -23.6, 7.0, 16.4)
ISLAND_HEIGHTS = {'podium': 6.4, 'bridge': (7.3, 14.2), 'roof': 25.3, 'mast_top': 39.5}

# Weapon sponsons (polygons, below flight-deck level) and mounts
SPONSONS = [
    [P(500, 745), P(440, 790), P(425, 975), P(500, 940)],          # forward port
    [P(975, 700), P(1045, 745), P(1048, 880), P(975, 870)],        # forward starboard
    [P(262, 3580), P(330, 3600), P(330, 3700), P(360, 3740), P(360, 3800),
     P(390, 3800), P(390, 3890), P(455, 3890), P(455, 3780), P(400, 3700)],  # aft port
    [P(1030, 3810), P(1030, 3890), P(1100, 3890), P(1125, 3700), P(1165, 3640), P(1160, 3592)],  # aft starboard
    [P(140, 2135), P(140, 2205), P(262, 2205), P(262, 2135)],      # port midships CIWS
    [P(160, 3400), P(160, 3480), P(262, 3480), P(262, 3400)],      # port aft dome
]
HQ10 = [P(470, 810), P(1005, 760), P(400, 3860), P(1060, 3860)]
CIWS = [P(462, 910), P(1020, 860), P(185, 2170), P(1110, 3760)]
DOMES = [P(195, 3440)]
# Folding whip antennas lowered outboard: (root X, Y, outboard length)
ANTENNAS = [(*P(205, 1200), 13.0), (*P(205, 1300), 13.0), (*P(205, 1400), 13.0),
            (*P(205, 1500), 13.0), (*P(262, 3255), 11.0), (*P(906, 42), -15.0)]
FLOLS = P(232, 3375)

# Hull: half-breadth stations
WATERLINE_HALF_BEAM = 20.0

# Flight-deck texture frame: square texels for a 2048 x 8192 image
X_TEX_MAX = 40.5
X_TEX_SPAN = 2048 / (8192 / LOA)     # 79.0 m across
