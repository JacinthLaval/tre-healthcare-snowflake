import torch
import bitsandbytes as bnb
from evo2 import Evo2


def quantize_model_4bit(model):
    """Replace linear layers with 4-bit quantized versions using bitsandbytes."""
    replacements = {}
    for name, module in model.named_modules():
        if isinstance(module, torch.nn.Linear):
            has_bias = module.bias is not None
            quantized = bnb.nn.Linear4bit(
                module.in_features,
                module.out_features,
                bias=has_bias,
                compute_dtype=torch.bfloat16,
                quant_type="nf4",
            )
            quantized.weight = bnb.nn.Params4bit(
                module.weight.data,
                requires_grad=False,
                quant_type="nf4",
            )
            if has_bias:
                quantized.bias = module.bias
            replacements[name] = quantized

    for name, quantized_module in replacements.items():
        parts = name.split(".")
        parent = model
        for part in parts[:-1]:
            parent = getattr(parent, part)
        setattr(parent, parts[-1], quantized_module)

    return model


def load_evo2_4bit(model_name="evo2_7b"):
    """Load Evo2 model and quantize to 4-bit."""
    print(f"Loading {model_name} in full precision...")
    evo2_model = Evo2(model_name)

    print("Quantizing linear layers to 4-bit NF4...")
    evo2_model.model = quantize_model_4bit(evo2_model.model)

    torch.cuda.empty_cache()

    mem_gb = torch.cuda.memory_allocated() / 1024**3
    print(f"GPU memory after quantization: {mem_gb:.1f} GB")

    return evo2_model


if __name__ == "__main__":
    model = load_evo2_4bit("evo2_7b")
    print("Testing forward pass...")
    sequence = "ACGTACGT"
    input_ids = torch.tensor(
        model.tokenizer.tokenize(sequence),
        dtype=torch.int,
    ).unsqueeze(0).to("cuda:0")
    outputs, _ = model(input_ids)
    print(f"Logits shape: {outputs[0].shape}")
    print("4-bit quantization successful!")
