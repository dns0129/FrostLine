import socket
import unittest
from unittest.mock import patch, MagicMock
import server

class PortDetectionTests(unittest.TestCase):
    def test_virtual_adapter_connection_does_not_count_as_local_listener(self):
        def connect(address, timeout):
            if address[0] == '127.0.0.1':
                raise ConnectionRefusedError()
            return MagicMock()
        with patch.object(socket, 'create_connection', side_effect=connect):
            self.assertFalse(server.port_is_listening(8766, ['100.64.164.2']))

    def test_real_loopback_listener_is_still_protected(self):
        with patch.object(socket, 'create_connection', return_value=MagicMock()):
            self.assertTrue(server.port_is_listening(8766, []))

class DestroyerServingTests(unittest.TestCase):
    def test_ship_runtime_modules_are_served(self):
        for name in ('destroyer.js', 'ship-camera.js', 'naval-models.js', 'ambient-fleet.js', 'campaign.js', 'aircraft-systems.js', 'aircraft-stores.js', 'hangar-workshop.js', 'docs/aircraft-systems.md',
                     'imported-airframe.js', 'j16.js', 'fujian.js', 'assets/models/j16.glb', 'assets/models/j16.metadata.json', 'assets/models/fujian.glb', 'assets/models/fujian.metadata.json',
                     'assets/models/j16-source/J-16.blend', 'assets/models/j16-source/COPYING'):
            with self.subTest(name=name):
                self.assertIsNotNone(server.game_path('/' + name))

    def test_source_and_verification_stay_private(self):
        for name in ('README.md', 'tests/browser-destroyer.mjs', 'verification/destroyer/metrics.json', '.openai/hosting.json'):
            with self.subTest(name=name):
                self.assertIsNone(server.game_path('/' + name))

if __name__ == '__main__':
    unittest.main()
