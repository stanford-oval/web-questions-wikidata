import fs from 'fs';
import path from 'path';
import * as argparse from 'argparse';

function main() {
    const parser = new argparse.ArgumentParser({
        add_help: true,
        description: `Split data into batches for annotation`
    });
    parser.add_argument('--batch-size', {
        default: 50,
        help: 'Number of examples per batch'
    });
    parser.add_argument('--prefix', {
        default: 'train',
        help: 'Prefix of the output file name'
    });
    parser.add_argument('input', {
        help: `Path to the input files`
    });

    const args = parser.parse_args();
    const examples = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
    const dir = path.dirname(args.input);
    for (let i = 0; i * args.batch_size < examples.length; i += 1) {
        const output = path.join(dir, `${args.prefix}-${('00' + i).slice(-3)}.json`);
        const batch = examples.slice(i * args.batch_size, (i + 1) * args.batch_size);
        fs.writeFileSync(output, JSON.stringify(batch, null, 2));
    }
}

if (require.main === module)
    main();