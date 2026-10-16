"""USS Enterprise (CVN-65) layout shared by the deck texture and the Blender build.

Final (2000s) configuration: rebuilt island with the SPS-48E / SPS-49 mast,
angled deck, two bow and two waist catapults, three starboard deck-edge
elevators (two forward of the island, one aft) and one port elevator aft.
Plan positions are a game-scale reading of public U.S. Navy photographs and
published dimensions (342 m overall, 78.3 m flight deck, 40.5 m waterline
beam, 11.3 m draft); they are not taken from ship drawings.

Pure Python (no bpy).  Axes: metres, +Z up (waterline 0), bow toward -Y, +X = port.
"""

LOA = 342.0
FLIGHT_DECK = 18.6           # flight deck above the waterline (estimate)
DRAFT = 11.3
GALLERY = FLIGHT_DECK - 5.0  # top of the hull loft / bottom of the gallery band

# Flight-deck edge, clockwise from the port bow corner.
DECK = [(8.0, -171.0), (16.5, -158.0), (21.0, -132.0), (23.0, -95.0), (24.5, -72.0), (35.0, -48.0),
        (41.8, -22.0), (42.3, 10.0), (42.3, 112.0), (40.5, 140.0), (36.0, 158.0), (30.0, 171.0),
        (-25.0, 171.0), (-31.0, 160.0), (-34.5, 140.0), (-36.0, 110.0), (-36.0, -98.0),
        (-33.0, -112.0), (-26.0, -130.0), (-20.0, -152.0), (-12.0, -171.0)]

# Deck-edge elevators (X0, X1, Y0, Y1): three starboard, one port aft.
ELEVATORS = [(-36.0, -22.0, -92.0, -72.0), (-36.0, -22.0, -64.0, -44.0),
             (-36.0, -22.0, 22.0, 42.0), (28.3, 42.3, 116.0, 134.0)]

# Steam catapults: (front point, launch/aft point)
CATAPULTS = [((-9.0, -167.0), (-9.0, -77.0)), ((7.0, -167.0), (3.5, -77.0)),
             ((24.0, -36.0), (12.0, 40.0)), ((33.5, -30.0), (22.0, 42.0))]
# Jet blast deflectors (X0, X1, Y0, Y1), aft of each launch point
JBDS = [(-14.5, -3.5, -71.5, -69.5), (-2.0, 9.0, -71.5, -69.5), (6.5, 17.5, 45.5, 47.5), (16.5, 27.5, 47.5, 49.5)]

# Angled landing area (bow end -> stern end), four arresting wires
LANDING_AXIS = ((31.0, -60.0), (-5.0, 168.0))
WIRE_Y = [102.0, 114.0, 126.0, 138.0]
WIRE_HALF_SPAN = 18.0

# Island (X0, X1, Y0, Y1) and heights above the flight deck
ISLAND = (-34.5, -25.0, -24.0, 12.0)
ISLAND_HEIGHTS = {'block': 15.0, 'bridge': 20.5, 'tower': 30.0, 'mast_top': 44.0}

# Weapon sponsons below the flight deck (polygons) and mounts on them
SPONSONS = [
    [(-26.0, -136.0), (-35.5, -136.0), (-36.5, -121.0), (-29.5, -116.0)],      # starboard fwd: Sea Sparrow
    [(21.5, -134.0), (29.0, -132.0), (29.5, -104.0), (23.2, -102.0)],          # port fwd: RAM + Phalanx
    [(36.0, 150.0), (43.0, 152.0), (42.0, 166.0), (32.0, 168.0)],             # port aft: Sea Sparrow
    [(-31.0, 150.0), (-38.0, 150.0), (-38.0, 166.0), (-27.0, 168.0)],          # starboard aft: Sea Sparrow
    [(-35.5, 120.0), (-41.0, 121.0), (-41.0, 140.0), (-34.5, 140.0)],          # starboard quarter: RAM + Phalanx
]
SEA_SPARROW = [(-31.5, -127.0), (38.5, 159.0), (-33.0, 159.0)]
RAM = [(26.0, -126.0), (-38.0, 135.0)]
PHALANX = [(26.5, -110.0), (-38.0, 125.0)]

# Flight-deck texture frame: square texels for a 2048 x 8192 image
X_TEX_MAX = 44.0
X_TEX_SPAN = 2048 / (8192 / LOA)    # 85.5 m across
