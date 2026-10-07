#[cfg(test)]
mod mvsn_v15_provenance_generator {
    use super::*;

    #[test]
    fn write_historical_fixture() {
        let output = std::env::var_os("MVSN_FIXTURE_OUTPUT").expect("fixture output path");
        let mut engine = Engine::new(4, 3);
        for index in 0..12usize {
            let pixel = index * 4;
            engine.layers[0].pixels[pixel] = 1000 + index as u16 * 1700;
            engine.layers[0].pixels[pixel + 1] = 3000 + index as u16 * 1300;
            engine.layers[0].pixels[pixel + 2] = 5000 + index as u16 * 900;
            engine.layers[0].pixels[pixel + 3] = u16::MAX;
        }
        engine.composite();
        engine.set_history_source();

        let id = engine.layers[0].id;
        engine.convert_to_smart_object(id);
        engine.smart_add_filter(id, 0, &[0.8]);

        let mut params = vec![0.0f32; 1086];
        params[0] = 1.0;
        params[1] = 1.0;
        params[4] = 0.3;
        params[10] = 0.4;
        params[12] = 0.2;
        params[16] = 1.0;
        params[25] = 1.0;
        for offset in [26usize, 282, 538, 794] {
            for index in 0..256 {
                params[offset + index] = index as f32;
            }
        }
        engine.smart_add_filter(id, 17, &params);

        std::fs::write(output, engine.save_project()).expect("write historical fixture");
    }
}
